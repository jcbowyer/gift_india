#!/usr/bin/env python3
"""Build a PDF from demo-screenshots/ for LLM screen-validation."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[1]
SHOTS_DIR = ROOT / "gift_india_web" / "demo-screenshots"
MANIFEST = SHOTS_DIR / "manifest.json"
OUT_PDF = ROOT / "demo-walkthrough-screenshots.pdf"


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "DemoTitle",
            parent=base["Title"],
            fontSize=22,
            leading=26,
            spaceAfter=12,
            textColor=colors.HexColor("#0f172a"),
        ),
        "meta": ParagraphStyle(
            "DemoMeta",
            parent=base["Normal"],
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#475569"),
            spaceAfter=6,
        ),
        "heading": ParagraphStyle(
            "DemoHeading",
            parent=base["Heading2"],
            fontSize=16,
            leading=20,
            spaceAfter=8,
            textColor=colors.HexColor("#0f172a"),
        ),
        "body": ParagraphStyle(
            "DemoBody",
            parent=base["Normal"],
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#334155"),
        ),
        "validate": ParagraphStyle(
            "DemoValidate",
            parent=base["Normal"],
            fontSize=10,
            leading=13,
            textColor=colors.HexColor("#1e40af"),
            leftIndent=12,
            spaceBefore=6,
        ),
    }


def _fit_image(path: Path, max_w: float, max_h: float) -> tuple[float, float]:
    from PIL import Image as PILImage

    with PILImage.open(path) as im:
        w, h = im.size
    scale = min(max_w / w, max_h / h, 1.0)
    return w * scale, h * scale


def build_pdf() -> Path:
    if not MANIFEST.exists():
        raise SystemExit(f"Missing manifest: {MANIFEST}\nRun: cd gift_india_web && npx playwright test tests/demo-screenshots.spec.ts")

    steps = json.loads(MANIFEST.read_text(encoding="utf-8"))
    styles = _styles()
    page_w, page_h = landscape(letter)
    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=landscape(letter),
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        title="GIFT Gauge Demo Walkthrough Screenshots",
        author="GIFT Gauge",
    )

    story: list = []
    story.append(Paragraph("GIFT Gauge — Demo Walkthrough Screenshots", styles["title"]))
    story.append(
        Paragraph(
            "Beyond the Hospital Directory · Grounding Improved Patient Care<br/>"
            "Use this PDF with an LLM to validate that each demo screen renders correctly.",
            styles["meta"],
        )
    )
    story.append(Spacer(1, 0.15 * inch))
    story.append(
        Paragraph(
            f"<b>{len(steps)} steps</b> from the in-app demo guide (DEMO.md). "
            "Each page shows the step metadata and a viewport capture (1280×800 — visible screen only, no scroll).",
            styles["body"],
        )
    )
    story.append(PageBreak())

    img_max_w = page_w - doc.leftMargin - doc.rightMargin
    img_max_h = page_h - doc.topMargin - doc.bottomMargin - 1.35 * inch

    for step in steps:
        img_path = SHOTS_DIR / step["file"]
        if not img_path.exists():
            raise SystemExit(f"Missing screenshot: {img_path}")

        story.append(
            Paragraph(
                f"Step {step['idx'] + 1} of {len(steps)} · {step['clock']} · <b>{step['phase']}</b>",
                styles["meta"],
            )
        )
        story.append(Paragraph(step["title"], styles["heading"]))
        story.append(Paragraph(f"<b>Route:</b> <font face='Courier'>{step['route']}</font>", styles["body"]))
        story.append(Paragraph(f"<b>Expected screen:</b> {step['screen']}", styles["body"]))
        story.append(
            Paragraph(
                "<b>LLM validation:</b> Confirm the screenshot matches the route and expected screen; "
                "check headings, data-demo regions, demo presenter overlay when immersive, and that live UI "
                "states (filters, expanded rows, map, reviews) look populated rather than error/empty unless noted.",
                styles["validate"],
            )
        )
        story.append(Spacer(1, 0.08 * inch))

        w, h = _fit_image(img_path, img_max_w, img_max_h)
        story.append(Image(str(img_path), width=w, height=h))
        story.append(PageBreak())

    doc.build(story)
    return OUT_PDF


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote {out}")
