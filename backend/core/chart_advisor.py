"""
Chart Advisor — Intelligent visualisation type selection.

Examines the user's question alongside the shape of the query output
to recommend the most appropriate chart type (bar, line, pie, scatter)
for frontend rendering.
"""
from core.llm_client import invoke_llm


def suggest_chart(question: str, outcome: dict) -> dict:
    """Return a chart recommendation based on question context and result shape."""
    if not outcome or outcome.get("error") or not outcome.get("rows"):
        return {"chart_type": "none", "x_axis": "", "y_axis": "", "title": ""}

    system = """You pick the best chart type for a data result.
Rules:
- Compare categories → bar
- Trend over time → line
- Part-of-whole (max 6 slices) → pie
- Two numeric columns → scatter
- Single number → none
- Multi-column mixed → table

Return ONLY valid JSON:
{"chart_type":"bar|line|pie|scatter|table|none","x_axis":"col","y_axis":"col","title":"..."}"""

    user = "Question: {}\nColumns: {}\nRow count: {}\nSample rows: {}".format(
        question,
        outcome.get('columns', []),
        outcome.get('row_count', 0),
        outcome.get('rows', [])[:3])

    try:
        return invoke_llm(system, user, temperature=0.1, max_tokens=150)
    except Exception:
        return {"chart_type": "table", "x_axis": "", "y_axis": "", "title": "Results"}
