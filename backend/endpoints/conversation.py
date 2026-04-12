"""
Conversation Endpoint — Primary analysis interface.

Receives a natural-language question, runs the full analytical pipeline,
and returns a structured response with the business narrative, query
results, chart recommendation, trust trace, and confidence assessment.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pipeline.workflow import analysis_workflow
from pipeline.state_schema import PipelineState
from core.session_manager import fetch_session, record_message, init_session
from core.source_registry import enumerate_sources
from core.query_executor import run_query
from core.chart_advisor import suggest_chart
from core.incident_handler import handle_incident
import traceback

router = APIRouter()


@router.post("/api/chat")
async def chat(payload: dict):
    try:
        session_id = payload.get("session_id") or init_session()
        session = fetch_session(session_id)
        sources = enumerate_sources(session_id)

        if not sources:
            return {"error": "No data sources connected. Please connect a database first.", "session_id": session_id}

        history_override = payload.get("history_override")
        if history_override is None:
            history_override = session.get("history", [])[-5:]

        initial_state: PipelineState = {
            "session_id": session_id,
            "user_question": payload["message"],
            "mode": payload.get("mode", "deep"),
            "source_ids": payload.get("source_ids") or [s.source_id for s in sources],
            "conversation_history": history_override,
            "available_sources": [{
                "source_id": s.source_id,
                "name": s.name,
                "safe_name": s.safe_name,
                "db_type": s.db_type.value,
                "schema": s.schema
            } for s in sources],
            "resolved_question": "",
            "intent_type": "aggregation",
            "metric_mappings": {},
            "assumptions": [],
            "selected_sources": [],
            "cross_db_query": False,
            "available_table_names": [],
            "audit_result": None,
            "generated_code": "",
            "code_type": "sql",
            "code_explanation": "",
            "tables_used": [],
            "retry_count": 0,
            "execution_result": None,
            "execution_error": None,
            "is_verified": False,
            "verification_note": "",
            "value_plausible": True,
            "confidence_score": None,
            "confidence_reasoning": None,
            "insight_narrative": "",
            "visualization": {},
            "suggested_followups": [],
            "trust_trace": [],
            "final_error": None,
        }

        state = analysis_workflow.invoke(initial_state)

        if state.get("generated_code") and not state.get("execution_result"):
            state["execution_result"] = run_query(
                session_id,
                state["generated_code"],
                state.get("code_type", "sql"),
                state.get("selected_sources") or state.get("source_ids", []),
                state.get("cross_db_query", False)
            )
            if state["execution_result"].get("error"):
                state["execution_error"] = state["execution_result"]["error"]

        if not state.get("visualization") and state.get("execution_result"):
            state["visualization"] = suggest_chart(
                state["user_question"], state["execution_result"]
            )

        record_message(session_id, "user", payload["message"])
        record_message(session_id, "assistant", state.get("insight_narrative", ""))

        return {
            "session_id": session_id,
            "user_message": payload["message"],
            "mode": state.get("mode"),
            "insight_narrative": state.get("insight_narrative", ""),
            "execution_result": state.get("execution_result"),
            "visualization": state.get("visualization", {}),
            "assumptions": state.get("assumptions", []),
            "trust_trace": state.get("trust_trace", []),
            "confidence_score": state.get("confidence_score"),
            "confidence_reasoning": state.get("confidence_reasoning"),
            "suggested_followups": state.get("suggested_followups", []),
            "generated_code": state.get("generated_code", ""),
            "code_explanation": state.get("code_explanation", ""),
            "is_verified": state.get("is_verified", False),
            "verification_note": state.get("verification_note", ""),
            "resolved_question": state.get("resolved_question", ""),
            "error": state.get("final_error")
        }

    except Exception as exc:
        traceback.print_exc()
        handle_incident(exc, context={
            "endpoint": "/api/chat",
            "message": payload.get("message", ""),
            "mode": payload.get("mode", ""),
            "session_id": payload.get("session_id", ""),
        })
        return JSONResponse(status_code=500, content={
            "error": "Analysis failed: {}".format(str(exc)),
            "session_id": payload.get("session_id", "")
        })


@router.get("/api/chat/history")
async def get_history(session_id: str):
    from core.session_manager import retrieve_history
    return {"history": retrieve_history(session_id)}
