{#
    Great-circle distance in kilometres between two lat/lon points.
    Pure SQL (Postgres trig functions) so the linkage between a facility and its
    geography centroid is computed in the warehouse, not Python.
#}
{% macro haversine_km(lat1, lon1, lat2, lon2) -%}
(
    6371 * 2 * asin(
        least(1, sqrt(
            power(sin(radians(({{ lat2 }} - {{ lat1 }}) / 2)), 2)
            + cos(radians({{ lat1 }})) * cos(radians({{ lat2 }}))
              * power(sin(radians(({{ lon2 }} - {{ lon1 }}) / 2)), 2)
        ))
    )
)
{%- endmacro %}
