"""
Metric Catalog — Canonical business-term definitions.

Maps common business keywords (revenue, churn, growth, etc.) to their
corresponding SQL interpretations. Agents reference this catalog to
ensure consistent metric computation across all generated queries.
"""
METRIC_DEFINITIONS = {
    "revenue": "SUM of columns named: total, amount, revenue, sales, sale_amount, price, value",
    "headcount": "COUNT(*) of rows in employee/person/staff tables",
    "churn": "COUNT of rows where status IN ('churned','inactive','left','terminated')",
    "avg order value": "AVG of columns named: amount, total, order_value",
    "growth": "Percentage change: (current - previous) / previous * 100",
    "top": "ORDER BY the primary metric DESC LIMIT N",
    "trend": "GROUP BY date/month/year, ORDER BY date ASC",
    "complaints": "COUNT of rows in complaint/ticket/issue tables",
    "conversion rate": "COUNT(converted) / COUNT(*) * 100",
    "profit": "SUM of columns named: profit, net_income, margin",
    "active users": "COUNT of rows where status = 'active' or last_login recent",
    "retention": "Percentage of users returning from prior period",
    "sales": "SUM of columns named: sales, revenue, amount, total_sales",
    "orders": "COUNT of rows in orders/transactions/purchases tables",
    "cac": "Marketing spend / new customers acquired",
    "ltv": "Average revenue per customer over their lifetime",
}


def build_metric_prompt() -> str:
    """Format the full catalog as a bullet list suitable for LLM system prompts."""
    return "\n".join("- {}: {}".format(k, v) for k, v in METRIC_DEFINITIONS.items())


def list_all_metrics() -> dict:
    """Return the entire metric definitions dictionary."""
    return METRIC_DEFINITIONS
