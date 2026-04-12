"""
Authentication Endpoints — Lightweight demo sign-in flow.

Accepts any username/password pair and issues a UUID-based session token
for tracking connected sources and conversation threads.
"""
from fastapi import APIRouter
import uuid
from core.session_manager import init_session

router = APIRouter()


@router.post("/api/auth/login")
async def login(payload: dict):
    token = str(uuid.uuid4())
    session_id = init_session()
    return {
        "token": token,
        "session_id": session_id,
        "username": payload.get("username", "user")
    }


@router.post("/api/auth/logout")
async def logout():
    return {"success": True}
