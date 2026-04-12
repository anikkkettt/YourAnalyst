"""
Download Endpoints — Export conversation history and query results.

Provides CSV and JSON export for chat history, plus CSV export for
individual query result sets.
"""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse, JSONResponse
from core.session_manager import retrieve_history
import csv, io, json

router = APIRouter()


@router.get("/api/export/history/csv")
async def export_history_csv(session_id: str):
    history = retrieve_history(session_id)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["timestamp", "role", "content"])
    writer.writeheader()
    for item in history:
        writer.writerow({
            "timestamp": item.get("timestamp", ""),
            "role": item.get("role", ""),
            "content": item.get("content", "")[:500]
        })
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=youranalyst_history_{}.csv".format(session_id[:8])}
    )


@router.get("/api/export/history/json")
async def export_history_json(session_id: str):
    history = retrieve_history(session_id)
    return {"session_id": session_id, "history": history}


@router.post("/api/export/result/csv")
async def export_result_csv(payload: dict):
    outcome = payload.get("result", {})
    columns = outcome.get("columns", [])
    rows = outcome.get("rows", [])
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(columns)
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=youranalyst_result.csv"}
    )
