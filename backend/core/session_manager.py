"""
Ephemeral Session Tracker — Volatile in-memory conversation state.

Maintains per-user query history and metadata using UUID-based isolation.
All data is lost on process restart by design (client-side persistence
handles durability).
"""
import uuid
from datetime import datetime, timedelta

_active_sessions: dict = {}


def init_session() -> str:
    sid = str(uuid.uuid4())
    _active_sessions[sid] = {"history": [], "created_at": datetime.utcnow()}
    return sid


def fetch_session(sid: str) -> dict:
    if sid not in _active_sessions:
        _active_sessions[sid] = {"history": [], "created_at": datetime.utcnow()}
    return _active_sessions[sid]


def record_message(sid: str, role: str, content: str):
    _active_sessions.setdefault(sid, {"history": [], "created_at": datetime.utcnow()})
    _active_sessions[sid]["history"].append({
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow().isoformat()
    })


def retrieve_history(sid: str) -> list:
    return _active_sessions.get(sid, {}).get("history", [])


def purge_stale():
    cutoff = datetime.utcnow() - timedelta(hours=3)
    stale_keys = [k for k, v in _active_sessions.items() if v["created_at"] < cutoff]
    for k in stale_keys:
        del _active_sessions[k]
