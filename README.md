# CareNavigator India

> A Virtue Foundation hackathon project — a **navigator copilot** that recommends
> where to place visiting surgical teams across India to close the surgical-care gap.

An estimated **143 million people** lack timely access to safe surgery. Virtue
Foundation maintains geotagged healthcare data describing *where care actually
lives today*. The hard problem: **match the right surgical team to the right
location based on specialty and need.**

CareNavigator India turns that data into action. Describe a team in plain
language — _"3-surgeon cataract team, 5 days, willing to travel rural"_ — and the
copilot ranks the **medical deserts** where that team will help the most people.

## The four hackathon tracks

| Track | What it does | Status here |
|-------|--------------|-------------|
| **Virtual Copilot / Navigator** | Chatbot that recommends where to place a surgical team | ✅ Demo (this repo) |
| **Medical Desert Planner** | Map + analytics of underserved, high-population areas | ✅ Included (map tab) |
| **Data Readiness Desk** | Entity-resolution pipeline producing the ~10K-record dataset | ✅ Seeded by the synthetic generator |
| **(open)** | — | — |

## Why India

India was chosen deliberately: it is one of the most *challenging* countries for
this problem — huge population, enormous regional variation, and messy,
semi-structured source data. The underlying dataset is **web-scraped, structured
and semi-structured, then governed**: classic information extraction turns text
into rows and columns, attributes each row to a hospital, and resolves duplicate
entities into a single primary key with a **confidence score** (named-entity
resolution).

> For the hackathon demo the dataset is **synthetically generated** with realistic
> Indian districts, coordinates, populations and specialties, so the app runs with
> zero external dependencies. Swap `src/data.py` for the governed Virtue Foundation
> dataset to go live.

## Quickstart

```bash
pip install -r requirements.txt
streamlit run app.py
```

Then open the local URL Streamlit prints (usually http://localhost:8501).

## How it works

1. **Data** (`src/data.py`) — generates/loads ~10K geotagged facility records and a
   district table (population, existing surgical capacity by specialty).
2. **Engine** (`src/matching.py`) — scores each district's *unmet need* for a
   specialty and ranks placement candidates by need × specialty gap × accessibility.
3. **Copilot** (`src/copilot.py`) — parses a natural-language team description into a
   structured query the engine can answer.
4. **UI** (`app.py`) — a Streamlit app with a chat-style copilot, a ranked
   recommendation list, and an interactive medical-desert map.

## Project layout

```
gift_india/
├── app.py              # Streamlit demo (copilot + map + planner)
├── requirements.txt
├── src/
│   ├── data.py         # dataset generation / loading
│   ├── matching.py     # recommendation engine
│   └── copilot.py      # natural-language request parsing
└── data/               # generated CSVs (gitignored)
```
