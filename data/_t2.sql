WITH f AS (
  SELECT name, officialWebsite, address_city, address_stateOrRegion,
    try_cast(distinct_social_media_presence_count AS int) AS social,
    try_cast(number_of_facts_about_the_organization AS int) AS facts,
    try_cast(recency_of_page_update AS date) AS recency,
    lower(regexp_replace(officialWebsite, '[^A-Za-z]', '')) AS web,
    filter(split(lower(regexp_replace(name, '[^A-Za-z ]', '')), ' '), w -> length(w) >= 5) AS name_words
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE address_countryCode = 'IN'
),
m AS (SELECT *, exists(name_words, w -> web LIKE '%' || w || '%') AS name_in_web FROM f)
SELECT name, officialWebsite, name_in_web, social, facts, recency
FROM m
WHERE name IN ('Aravind Eye Hospital','Fortis Hospital Anandapur','Wockhardt Hospital Nagpur')
UNION ALL
SELECT name, officialWebsite, name_in_web, social, facts, recency
FROM m WHERE NOT name_in_web AND social <= 1 LIMIT 8
