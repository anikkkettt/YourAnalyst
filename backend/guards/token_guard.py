"""
Token Guard — Request authentication middleware.

Intercepts all incoming requests and enforces bearer token presence,
with exceptions for public routes like login and health checks.
"""
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

OPEN_ROUTES = {"/api/auth/login", "/api/auth/logout", "/health", "/docs", "/openapi.json"}


class TokenGuard(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in OPEN_ROUTES or request.method == "OPTIONS":
            return await call_next(request)
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")
        return await call_next(request)
