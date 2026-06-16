{#
    Entity-resolution name normalization for JCI accreditation matching.

    Collapses a messy facility / organization name to its distinctive part by
    lower-casing, expanding `&` -> `and`, replacing punctuation with spaces, and
    stripping generic / legal / geographic tokens (hospital, the, of, ltd, super
    speciality, india, …). Locality words embedded in a name are NOT stripped, so
    brand_key + state does the cross-naming match. e.g.

        "Apollo Hospitals Enterprise Limited" -> "apollo"
        "Fortis Memorial Research Institute"  -> "fortis memorial"
        "Apollo Hospital, Chennai"            -> "apollo chennai"

    MUST stay in lock-step with `GENERIC_TOKENS` / `significant_tokens` in
    gift_india_api/src/jci_scraper.py so the Python pre-match and this dbt join
    agree on the same key.
#}
{% macro jci_normalize(col) -%}
trim(
    regexp_replace(
        regexp_replace(
            regexp_replace(lower(replace(coalesce({{ col }}, ''), '&', ' and ')),
                '[^a-z0-9]+', ' ', 'g'),
            '\y(the|of|and|for|a|hospital|hospitals|clinic|clinics|centre|center'
            '|institute|institutes|medical|medicity|sciences|science|research'
            '|speciality|specialty|superspeciality|superspecialty|super'
            '|multispeciality|multispecialty|multi|healthcare|health|care'
            '|nursing|home|ltd|limited|pvt|private|enterprise|enterprises'
            '|india|international|national|global)\y',
            ' ', 'g'),
        '\s+', ' ', 'g')
)
{%- endmacro %}


{#
    First `n` significant tokens of a normalized name — a coarse "brand" key used
    for state-scoped matching (e.g. "fortis memorial", "apollo greams"). Mirrors
    `brand_key()` in jci_scraper.py.
#}
{% macro jci_brand_key(col, n=2) -%}
array_to_string(
    (string_to_array({{ jci_normalize(col) }}, ' '))[1:{{ n }}],
    ' '
)
{%- endmacro %}
