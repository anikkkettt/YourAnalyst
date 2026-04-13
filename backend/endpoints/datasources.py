"""
Data Source Endpoints — Connection lifecycle management.

Handles connecting, listing, testing, uploading, and removing data sources
(SQL databases, CSV uploads, Excel files). Also exposes a demo endpoint
that seeds a pre-built sample dataset for immediate exploration.
"""
from fastapi import APIRouter, UploadFile, File, Form
from typing import List
from fastapi.responses import JSONResponse
from core.connection_manager import ConnectionManager, DatabaseKind, friendly_db_error
from core.source_registry import register_source, lookup_source, enumerate_sources, unregister_source
import tempfile, os, shutil, glob as _glob, pandas as pd, sqlalchemy as sa, json
from datetime import datetime
from core.llm_client import invoke_llm

router = APIRouter()
connector = ConnectionManager()


@router.post("/api/sources/test")
async def test_source(payload: dict):
    try:
        db_type = DatabaseKind(payload["db_type"])
        return connector.test_connection(db_type, payload.get("config", {}))
    except Exception as exc:
        return {"success": False, "error": friendly_db_error(exc), "table_count": 0}


@router.post("/api/sources/connect")
async def connect_source(payload: dict):
    try:
        db_type = DatabaseKind(payload["db_type"])
        selected_tables = payload.get("selected_tables")
        source = connector.connect(db_type, payload.get("config", {}), payload["name"], payload["session_id"], selected_tables)
        register_source(source)
        return {
            "source_id": source.source_id,
            "name": source.name,
            "safe_name": source.safe_name,
            "db_type": source.db_type.value,
            "table_count": source.table_count,
            "schema": source.schema,
            "connected_at": source.connected_at,
            "is_connected": source.is_connected
        }
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": friendly_db_error(exc)})


@router.post("/api/sources/upload")
async def upload_file(
    files: List[UploadFile] = File(...),
    session_id: str = Form(...),
):
    results = []
    errors = []
    for file in files:
        try:
            suffix = os.path.splitext(file.filename)[1].lower()
            if suffix not in (".csv", ".xlsx", ".xls"):
                errors.append({"file": file.filename, "error": "Only CSV and Excel files are supported"})
                continue

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                shutil.copyfileobj(file.file, tmp)
                tmp_path = tmp.name

            db_type = DatabaseKind.CSV if suffix == ".csv" else DatabaseKind.EXCEL
            source = connector.connect(db_type, {"file_path": tmp_path}, file.filename, session_id)
            register_source(source)

            results.append({
                "source_id": source.source_id,
                "name": source.name,
                "safe_name": source.safe_name,
                "db_type": source.db_type.value,
                "table_count": source.table_count,
                "schema": source.schema,
                "connected_at": source.connected_at,
                "is_connected": source.is_connected
            })
        except Exception as exc:
            errors.append({"file": file.filename, "error": str(exc)})

    if not results and errors:
        return JSONResponse(status_code=400, content={"error": errors[0]["error"], "errors": errors})

    return {"sources": results, "errors": errors}


@router.get("/api/sources")
async def get_sources(session_id: str):
    sources = enumerate_sources(session_id)
    return [{"source_id": s.source_id, "name": s.name, "safe_name": s.safe_name,
             "db_type": s.db_type.value, "table_count": s.table_count,
             "is_connected": s.is_connected, "connected_at": s.connected_at}
            for s in sources]


@router.get("/api/sources/{source_id}/schema")
async def get_schema(source_id: str):
    try:
        source = lookup_source(source_id)
        return source.schema
    except KeyError:
        return JSONResponse(status_code=404, content={"error": "Source not found"})


@router.get("/api/sources/sample-creds/{db_type}")
async def get_sample_creds(db_type: str):
    try:
        not_configured = JSONResponse(
            status_code=404,
            content={"error": "Sample not configured — set the required environment variables."}
        )

        if db_type == "postgresql":
            host = os.environ.get("SUPABASE_HOST")
            user = os.environ.get("SUPABASE_USER")
            pwd = os.environ.get("SUPABASE_PASSWORD")
            if not (host and user and pwd):
                return not_configured
            return {
                "source_name": "Supabase Sales Sample",
                "host": host,
                "port": os.environ.get("SUPABASE_PORT", "5432"),
                "database": os.environ.get("SUPABASE_DATABASE", "postgres"),
                "username": user,
                "password": pwd
            }
        elif db_type == "mysql":
            host = os.environ.get("TIDB_HOST")
            user = os.environ.get("TIDB_USER")
            pwd = os.environ.get("TIDB_PASSWORD")
            if not (host and user and pwd):
                return not_configured
            return {
                "source_name": "TiDB Sales Sample",
                "host": host,
                "port": os.environ.get("TIDB_PORT", "4000"),
                "database": os.environ.get("TIDB_DATABASE", "fortune500"),
                "username": user,
                "password": pwd
            }
        return JSONResponse(status_code=404, content={"error": "Sample not configured for this type"})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.post("/api/sources/demo")
async def connect_demo(payload: dict):
    try:
        session_id = payload["session_id"]
        requested_type = payload.get("db_type", "sqlite")

        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sample_dir = os.path.join(os.path.dirname(base_dir), "sample_data")

        def _find_sample_excel():
            """Return the first .xlsx file in sample_data/, or None."""
            matches = _glob.glob(os.path.join(sample_dir, "*.xlsx"))
            return matches[0] if matches else None

        if requested_type in ("csv", "excel"):
            excel_path = _find_sample_excel()
            if not excel_path:
                return JSONResponse(status_code=404, content={"error": "No sample Excel file found in sample_data/"})
            source = connector.connect(DatabaseKind.EXCEL, {"file_path": excel_path},
                                       "Sample Sales Dataset", session_id)
        elif requested_type == "postgresql":
            params = {
                "username": os.environ.get("SUPABASE_USER"),
                "password": os.environ.get("SUPABASE_PASSWORD"),
                "host": os.environ.get("SUPABASE_HOST"),
                "port": int(os.environ.get("SUPABASE_PORT", 5432)),
                "database": os.environ.get("SUPABASE_DATABASE") or "postgres"
            }
            source = connector.connect(DatabaseKind.POSTGRESQL, params, "Supabase Sales Sample", session_id)
        elif requested_type == "mysql":
            params = {
                "username": os.environ.get("TIDB_USER"),
                "password": os.environ.get("TIDB_PASSWORD"),
                "host": os.environ.get("TIDB_HOST"),
                "port": int(os.environ.get("TIDB_PORT", 4000)),
                "database": os.environ.get("TIDB_DATABASE") or "fortune500"
            }
            source = connector.connect(DatabaseKind.MYSQL, params, "TiDB Sales Sample", session_id)
        elif requested_type in ("sqlite", "turso"):
            excel_path = _find_sample_excel()
            if not excel_path:
                return JSONResponse(status_code=404, content={"error": "No sample file found in sample_data/"})
            source = connector.connect(DatabaseKind.EXCEL, {"file_path": excel_path},
                                       "Sample Sales Dataset", session_id)
        else:
            excel_path = _find_sample_excel()
            if not excel_path:
                return JSONResponse(status_code=404, content={"error": "No sample file found in sample_data/"})
            source = connector.connect(DatabaseKind.EXCEL, {"file_path": excel_path},
                                       "Sample Sales Dataset", session_id)

        register_source(source)

        return {
            "source_id": source.source_id,
            "name": source.name,
            "safe_name": source.safe_name,
            "db_type": source.db_type.value,
            "table_count": source.table_count,
            "schema": source.schema,
            "connected_at": source.connected_at,
            "is_connected": source.is_connected
        }
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/api/sources/suggest-questions")
async def suggest_questions(payload: dict):
    try:
        session_id = payload.get("session_id")
        source_id = payload.get("source_id")

        sources = enumerate_sources(session_id)
        if source_id:
            sources = [s for s in sources if s.source_id == source_id]

        if not sources:
            return {"questions": ["What can I ask about my data?", "How do I get started?", "What tables are available?"]}

        schema_ctx = []
        for s in sources:
            source_info = "Source: {} ({})\n".format(s.name, s.db_type.value)
            for tname, tinfo in s.schema.get("tables", {}).items():
                cols = [c["name"] for c in tinfo.get("columns", [])]
                source_info += "  Table: {} | Columns: {}\n".format(tname, ", ".join(cols))
            schema_ctx.append(source_info)

        ctx_str = "\n".join(schema_ctx)

        system = """You are a Data Analyst. Based on the provided database schema, suggest 3-5 high-value business analytical questions.
Each question should be concise and directly queryable using the columns provided.
Target a mix of ranking, trend analysis, and descriptive statistics.
Return ONLY a JSON array of strings."""

        user_input = "Schema Context:\n{}".format(ctx_str)

        questions = invoke_llm(system, user_input, temperature=0.7, max_tokens=300)
        if not isinstance(questions, list):
            questions = ["What are the top trends in this data?", "Summarize the key metrics", "Which categories have the most impact?"]

        return {"questions": questions}
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Error generating suggestions: %s", exc)
        return {"questions": ["What is the overall trend?", "List the top items by value", "Compare performance over time"]}


@router.post("/api/sources/clone")
async def clone_session_sources(payload: dict):
    from core.source_registry import duplicate_sources
    try:
        from_id = payload["from_session_id"]
        to_id = payload["to_session_id"]
        duplicate_sources(from_id, to_id)
        return {"success": True}
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


@router.post("/api/sources/{source_id}/relationships")
async def get_relationships(source_id: str):
    try:
        source = lookup_source(source_id)
        from core.relationship_inference import infer_relationships
        relationships = infer_relationships(source)
        return {"relationships": relationships}
    except KeyError:
        return JSONResponse(status_code=404, content={"error": "Source not found"})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.delete("/api/sources/{source_id}")
async def disconnect(source_id: str):
    try:
        unregister_source(source_id)
        return {"success": True}
    except KeyError:
        return JSONResponse(status_code=404, content={"error": "Source not found"})
