"""CareNavigator India — Streamlit demo.

A navigator copilot that recommends where to place visiting surgical teams across
India to close the surgical-care gap, plus a medical-desert map and a peek at the
governed dataset.

Run with:  streamlit run app.py
"""
from __future__ import annotations

import pandas as pd
import pydeck as pdk
import streamlit as st

from src.copilot import parse_request
from src.data import SPECIALTIES, load_bundle
from src.matching import TeamRequest, rank_districts

st.set_page_config(
    page_title="CareNavigator India",
    page_icon="🩺",
    layout="wide",
)


@st.cache_data(show_spinner="Loading Virtue Foundation dataset…")
def get_bundle():
    return load_bundle()


bundle = get_bundle()


def desert_layers(result, facilities: pd.DataFrame) -> list[pdk.Layer]:
    rec_df = pd.DataFrame(
        [
            {
                "district": r.district,
                "state": r.state,
                "lat": r.lat,
                "lon": r.lon,
                "unmet_need": r.unmet_need,
                "score": r.score,
                "radius": 8000 + r.score * 90000,
            }
            for r in result.recommendations
        ]
    )
    surg = facilities[facilities["offers_surgery"]]
    return [
        pdk.Layer(
            "ScatterplotLayer",
            data=surg,
            get_position="[lon, lat]",
            get_radius=2500,
            get_fill_color=[120, 170, 255, 70],
            pickable=False,
        ),
        pdk.Layer(
            "ScatterplotLayer",
            data=rec_df,
            get_position="[lon, lat]",
            get_radius="radius",
            get_fill_color=[230, 80, 70, 150],
            get_line_color=[255, 255, 255],
            line_width_min_pixels=1,
            pickable=True,
        ),
    ]


def render_map(result):
    layers = desert_layers(result, bundle.facilities)
    view = pdk.ViewState(latitude=22.5, longitude=80.0, zoom=3.7, pitch=0)
    tooltip = {
        "html": "<b>{district}, {state}</b><br/>Unmet need: {unmet_need}/yr",
        "style": {"backgroundColor": "#1a1a2e", "color": "white"},
    }
    st.pydeck_chart(
        pdk.Deck(
            layers=layers,
            initial_view_state=view,
            map_style="road",
            tooltip=tooltip,
        )
    )
    st.caption(
        "🔵 Existing surgical facilities  ·  🔴 Recommended deployment sites "
        "(larger = higher priority)"
    )


def show_recommendations(result):
    for i, rec in enumerate(result.recommendations, start=1):
        with st.container(border=True):
            top = st.columns([3, 1, 1, 1])
            top[0].markdown(f"### {i}. {rec.district}, {rec.state}")
            top[1].metric("Priority", f"{rec.score:.2f}")
            top[2].metric("Unmet need/yr", f"{rec.unmet_need:,}")
            top[3].metric("Team can clear", f"{rec.team_impact:,}")
            st.write(rec.rationale)
            st.progress(
                min(
                    rec.existing_capacity / max(rec.estimated_annual_need, 1), 1.0
                ),
                text=(
                    f"Current coverage: {rec.existing_capacity:,} of "
                    f"{rec.estimated_annual_need:,} procedures/yr"
                ),
            )


# ---------------------------------------------------------------- Sidebar
st.sidebar.title("🩺 CareNavigator India")
st.sidebar.caption("Virtue Foundation · surgical-team navigator")
st.sidebar.metric("Facilities in dataset", f"{len(bundle.facilities):,}")
st.sidebar.metric(
    "Surgical facilities",
    f"{int(bundle.facilities['offers_surgery'].sum()):,}",
)
st.sidebar.metric("Districts covered", f"{len(bundle.districts):,}")
st.sidebar.divider()
st.sidebar.markdown(
    "**The gap:** ~143M people lack timely access to safe surgery. "
    "This tool helps place the right team in the right place."
)

# ---------------------------------------------------------------- Tabs
tab_copilot, tab_planner, tab_data = st.tabs(
    ["💬 Copilot", "🗺️ Medical Desert Planner", "🗂️ Data Readiness Desk"]
)

# ============================================================ Copilot tab
with tab_copilot:
    st.subheader("Describe your surgical team")
    st.markdown(
        "Tell the navigator who's deploying — e.g. "
        "_“3-surgeon cataract team for 5 days, rural ok”_ — and it ranks the "
        "medical deserts where you'll help the most people."
    )

    examples = [
        "3-surgeon cataract team for 5 days, rural ok",
        "team of 4 obstetrics surgeons, 7 days, remote areas",
        "2 cleft & plastic surgeons for 10 days",
        "orthopaedic team of 3, urban only, 5 days",
    ]
    ex_cols = st.columns(len(examples))
    if "copilot_text" not in st.session_state:
        st.session_state.copilot_text = examples[0]
    for col, ex in zip(ex_cols, examples):
        if col.button(ex, use_container_width=True):
            st.session_state.copilot_text = ex

    text = st.text_input(
        "Team description",
        key="copilot_text",
        label_visibility="collapsed",
    )

    req, message = parse_request(text)
    if req is None:
        st.warning(message)
    else:
        st.success(message)
        result = rank_districts(bundle, req, top_n=8)
        left, right = st.columns([1, 1])
        with left:
            show_recommendations(result)
        with right:
            render_map(result)

# ==================================================== Medical Desert Planner
with tab_planner:
    st.subheader("Medical Desert Planner")
    col1, col2, col3 = st.columns(3)
    specialty = col1.selectbox("Specialty", SPECIALTIES, index=0)
    team_size = col2.slider("Team size", 1, 10, 3)
    days = col3.slider("Days on site", 1, 30, 5)
    rural_ok = st.checkbox("Open to rural / remote sites", value=True)

    req = TeamRequest(
        specialty=specialty, team_size=team_size, days=days, rural_ok=rural_ok
    )
    result = rank_districts(bundle, req, top_n=12)

    render_map(result)

    table = result.district_table.sort_values("score", ascending=False)[
        [
            "district",
            "state",
            "population",
            "estimated_annual_need",
            "existing_capacity",
            "unmet_need",
            "coverage_ratio",
            "score",
        ]
    ].head(20)
    st.dataframe(
        table,
        use_container_width=True,
        hide_index=True,
        column_config={
            "coverage_ratio": st.column_config.ProgressColumn(
                "Coverage", min_value=0, max_value=1, format="%.0f%%"
            ),
            "score": st.column_config.NumberColumn("Priority", format="%.3f"),
            "population": st.column_config.NumberColumn(format="%d"),
        },
    )

# ===================================================== Data Readiness Desk
with tab_data:
    st.subheader("Data Readiness Desk")
    st.markdown(
        "The dataset is **web-scraped → extracted → governed**. Free text becomes "
        "rows/columns, each row is attributed to a hospital, and duplicate entities "
        "are resolved to a single primary key with a **match confidence score** "
        "(named-entity resolution)."
    )

    c1, c2, c3, c4 = st.columns(4)
    f = bundle.facilities
    c1.metric("Records", f"{len(f):,}")
    c2.metric("Mean match confidence", f"{f['match_confidence'].mean():.2f}")
    low_conf = int((f["match_confidence"] < 0.7).sum())
    c3.metric("Need review (<0.70)", f"{low_conf:,}")
    c4.metric("Specialties tracked", f"{len(SPECIALTIES)}")

    st.markdown("**Confidence distribution**")
    st.bar_chart(
        pd.cut(f["match_confidence"], bins=[0.4, 0.6, 0.7, 0.8, 0.9, 1.0])
        .value_counts()
        .sort_index()
    )

    min_conf = st.slider("Filter by minimum match confidence", 0.4, 1.0, 0.4, 0.05)
    state_filter = st.multiselect(
        "States", sorted(f["state"].unique()), default=[]
    )
    view = f[f["match_confidence"] >= min_conf]
    if state_filter:
        view = view[view["state"].isin(state_filter)]
    st.caption(f"Showing {len(view):,} records")
    st.dataframe(
        view[
            [
                "facility_id",
                "name",
                "type",
                "district",
                "state",
                "specialties",
                "annual_surgeries",
                "match_confidence",
            ]
        ].head(500),
        use_container_width=True,
        hide_index=True,
    )
