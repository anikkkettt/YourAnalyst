"""
Analysis Workflow — Orchestration graph for the data pipeline.

Defines the directed acyclic graph (DAG) that coordinates all processing nodes.
The workflow adapts its depth based on the selected analysis mode:

  Quick:   Intent → SQL → Executor → Validator → Narrator → END
  Deep:    Intent → Audit → SQL → Executor → Validator → Confidence → Narrator → Viz → Followup → END
  Compare: Same as Deep, with comparison-specific prompts at each stage.

Self-correction loops (Executor → SQL Generator) retry up to 2 times on failures.
"""
from langgraph.graph import StateGraph, END
from pipeline.state_schema import PipelineState
from pipeline import intent_parser, assumption_checker, sql_generator, result_validator, trust_scorer, insight_writer, suggestion_engine
from core import query_executor, chart_advisor

def _execute_node(state: dict) -> dict:
    if state.get("generated_code"):
        result = query_executor.run_query(
            state["session_id"],
            state["generated_code"],
            state["code_type"],
            state["selected_sources"] or state["source_ids"],
            state.get("cross_db_query", False)
        )
        state["execution_result"] = result
        if result.get("error"):
            state["execution_error"] = result["error"]
        else:
            state["execution_error"] = None
    return state

def _viz_node(state: dict) -> dict:
    if state.get("execution_result") and not state.get("visualization"):
        state["visualization"] = chart_advisor.suggest_chart(
            state["user_question"], state["execution_result"]
        )
    return state

def _route_after_semantic(state):
    return "audit" if state["mode"] in ["deep", "compare"] else "coder"

def _route_after_executor(state):
    if state.get("execution_error") and state.get("retry_count", 0) < 2:
        return "self_correct"
    return "critic"

def _route_after_critic(state):
    if not state.get("is_verified") and state.get("retry_count", 0) < 2 and state["mode"] in ["deep", "compare"]:
        return "self_correct"
    
    return "confidence" if state["mode"] in ["deep", "compare"] else "narrator"

def _route_after_narrator(state):
    return END if state["mode"] == "quick" else "viz"

def _route_after_viz(state):
    return END if state["mode"] == "quick" else "followup"

def build_graph() -> StateGraph:
    graph = StateGraph(PipelineState)

    graph.add_node("semantic", intent_parser.parse_intent)
    graph.add_node("audit", assumption_checker.audit_assumptions)
    graph.add_node("coder", sql_generator.generate_sql)
    graph.add_node("executor", _execute_node)
    graph.add_node("self_correct", sql_generator.revise_sql)
    graph.add_node("critic", result_validator.validate_result)
    graph.add_node("confidence", trust_scorer.compute_confidence)
    graph.add_node("narrator", insight_writer.compose_narrative)
    graph.add_node("viz", _viz_node)
    graph.add_node("followup", suggestion_engine.suggest_followups)

    graph.set_entry_point("semantic")

    graph.add_conditional_edges("semantic", _route_after_semantic, {
        "audit": "audit",
        "coder": "coder"
    })
    graph.add_edge("audit", "coder")
    graph.add_edge("coder", "executor")
    graph.add_conditional_edges("executor", _route_after_executor, {
        "self_correct": "self_correct",
        "critic": "critic"
    })
    graph.add_edge("self_correct", "executor")
    graph.add_conditional_edges("critic", _route_after_critic, {
        "self_correct": "self_correct",
        "confidence": "confidence",
        "narrator": "narrator"
    })
    graph.add_edge("confidence", "narrator")
    graph.add_conditional_edges("narrator", _route_after_narrator, {
        "viz": "viz",
        END: END
    })
    graph.add_conditional_edges("viz", _route_after_viz, {
        "followup": "followup",
        END: END
    })
    graph.add_edge("followup", END)

    return graph.compile()

analysis_workflow = build_graph()
