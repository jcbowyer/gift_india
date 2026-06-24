"""Pytest bootstrap for the gift_india_api loaders/engine.

Puts this directory (the package root that holds ``src/``) on ``sys.path`` so the
tests can ``from src import scraper`` exactly the way the CLIs are invoked
(``python -m src.scraper``), regardless of where pytest is launched from.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
