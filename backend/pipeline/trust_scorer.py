"""
Trust Scorer — Quantitative confidence assessment.

Computes a 0-100 confidence score for the analysis output. Starts at 100
and applies penalty deductions for risky assumptions, unknown factors,
retries, and low row counts. Used in Deep and Compare modes to provide
users with a numeric trust signal alongside the narrative.
"""
from core.llm_client import invoke_llm, MODEL_RELIABILITY
from datetime import datetime
import json

def compute_confidence(state: dict) -> dict:
    risky = sum(1 for a in state.get("assumptions", []) if a.get("risk") == "RISKY")
    unknown = sum(1 for a in state.get("assumptions", []) if a.get("risk") == "UNKNOWN")
    retried = state.get("retry_count", 0) > 0
    rows = state.get("execution_result", {}).get("row_count", 10)

    system = """You are a statistical confidence evaluator.
Start at 100. Deduct: 15 per RISKY assumption, 10 per UNKNOWN, 10 if retry needed, 5 if <5 rows.
Return ONLY valid JSON:
{"score": 87, "reasoning": "...", "deductions": [{"reason":"...", "points":15}]}"""

    user = f"""RISKY assumptions: {risky}
UNKNOWN assumptions: {unknown}
Retry occurred: {retried}
Result rows: {rows}
Critic note: {state.get('verification_note','')}"""

    deductions = []
    try:
        result = invoke_llm(system, user, temperature=0.1, max_tokens=300, model=MODEL_RELIABILITY)
        state["confidence_score"] = result.get("score", max(50, 100 - risky*15 - unknown*10))
        state["confidence_reasoning"] = result.get("reasoning", "")
        deductions = result.get("deductions", [])
    except Exception:
        state["confidence_score"] = max(50, 100 - risky*15 - unknown*10)
        state["confidence_reasoning"] = "Computed from assumptions."

    if not isinstance(state.get("trust_trace"), list):
        state["trust_trace"] = []

    if not deductions:
        if risky: deductions.append({"reason": f"{risky} RISKY assumption(s)", "points": risky * 15})
        if unknown: deductions.append({"reason": f"{unknown} UNKNOWN assumption(s)", "points": unknown * 10})
        if retried: deductions.append({"reason": "Query retry required", "points": 10})
        if rows < 5: deductions.append({"reason": f"Low row count ({rows} rows)", "points": 5})

    state["trust_trace"].append({
        "agent": "Trust Scorer",
        "action": f"Trust Assessment: {state['confidence_score']}%",
        "output": state.get("confidence_reasoning", ""),
        "color": "agent-critic",
        "timestamp": datetime.utcnow().isoformat(),
        "details": {
            "score": state["confidence_score"],
            "reasoning": state.get("confidence_reasoning", ""),
            "deductions": deductions,
            "row_count": rows,
            "risky_count": risky,
            "unknown_count": unknown,
            "retried": retried,
        }
    })
    return state
