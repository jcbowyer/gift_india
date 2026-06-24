{{
    config(
        materialized='view',
        schema='silver',
    )
}}

-- Silver facility web crawl: cleaned, typed, deduped website crawls.
--
-- Bronze keeps every crawl attempt for provenance; silver collapses that history
-- to one row per facility (or per URL when the crawl is not yet linked to a
-- facility), keeping the most recent SUCCESSFUL crawl — falling back to the
-- latest attempt so a URL that has only ever failed is still observable with its
-- error. It also derives lightweight contact signals (primary email + phone)
-- from the boilerplate-stripped `raw_text`, which is the replayable extraction
-- input bronze is designed to preserve. Feeds website-sourced gold evidence.

with crawls as (
    select * from {{ source('bronze', 'facility_web_crawl') }}
),

typed as (
    select
        trim(crawl_id)                          as crawl_id,
        nullif(trim(facility_id), '')           as facility_id,
        nullif(trim(name), '')                  as name,
        nullif(trim(website_url), '')           as website_url,
        nullif(trim(final_url), '')             as final_url,
        cast(crawled_at as timestamp)           as crawled_at,
        lower(nullif(trim(status), ''))         as status,
        cast(http_status as integer)            as http_status,
        nullif(trim(content_type), '')          as content_type,
        nullif(trim(title), '')                 as title,
        nullif(trim(raw_text), '')              as raw_text,
        nullif(trim(error), '')                 as error
    from crawls
    where nullif(trim(website_url), '') is not null
),

-- Grain key: prefer the (provisional) facility link, else the resolved URL.
keyed as (
    select
        *,
        coalesce(facility_id, lower(coalesce(final_url, website_url))) as crawl_key
    from typed
),

-- Most recent successful crawl per key; a key that only ever failed keeps its
-- latest attempt so the failure and its error stay visible downstream.
ranked as (
    select
        *,
        row_number() over (
            partition by crawl_key
            order by (status = 'ok') desc, crawled_at desc nulls last
        ) as _rn
    from keyed
),

latest as (
    select * from ranked where _rn = 1
)

select
    crawl_id,
    crawl_key,
    facility_id,
    name,
    website_url,
    final_url,
    crawled_at,
    status,
    (status = 'ok')                       as crawl_ok,
    http_status,
    content_type,
    title,
    error,
    coalesce(length(raw_text), 0)         as text_length,
    raw_text,
    -- First email found in the page text (lower-cased). Mirrors the scraper's
    -- email pattern; NULL when the page has no contact address.
    lower(
        (regexp_match(raw_text, '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'))[1]
    )                                     as contact_email,
    -- First plausible Indian phone number: a digit run whose stripped length is
    -- 10–13 (landline/mobile, optional +91 / leading 0), mirroring the scraper.
    (
        select m[1]
        from regexp_matches(
            raw_text, '(?:(?:\+?91[\-\s]?)|0)?(?:\d[\-\s]?){9,14}\d', 'g'
        ) as m
        where length(regexp_replace(m[1], '\D', '', 'g')) between 10 and 13
        limit 1
    )                                     as contact_phone
from latest
