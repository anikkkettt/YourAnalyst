"""
Request & Response Contracts — Pydantic models for API validation.

Defines the typed shapes for incoming requests and outgoing responses
used across all endpoint routers.
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class SignInRequest(BaseModel):
    username: str
    password: str


class SignInResponse(BaseModel):
    token: str
    session_id: str
    username: str


class ConnectionTestRequest(BaseModel):
    db_type: str
    config: Dict[str, Any]


class ConnectionEstablishRequest(BaseModel):
    db_type: str
    config: Dict[str, Any]
    name: str
    session_id: str


class AnalysisRequest(BaseModel):
    message: str
    session_id: str
    mode: str = "deep"
    source_ids: Optional[List[str]] = None


class ResultExportRequest(BaseModel):
    result: Dict[str, Any]
    filename: Optional[str] = "result"
