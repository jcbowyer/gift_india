WITH f AS (
  SELECT name, officialWebsite,
    lower(regexp_replace(officialWebsite, '[^A-Za-z]', '')) AS web,
    filter(split(lower(regexp_replace(name, '[^A-Za-z ]', '')), ' '), w -> length(w) >= 5) AS name_words
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE address_countryCode = 'IN'
),
m AS (
  SELECT *, exists(name_words, w -> web LIKE '%' || w || '%') AS name_in_web FROM f
)
SELECT name_in_web, count(*) AS n FROM m GROUP BY name_in_web ORDER BY n DESC
