from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from endpoints import authentication, datasources, conversation, downloads, profiling
import os


@asynccontextmanager
async def lifespan(application: FastAPI):
    yield
    from core.session_manager import purge_stale
    purge_stale()


app = FastAPI(
    title="YourAnalyst API",
    description="Ask anything. Trust everything.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(authentication.router)
app.include_router(datasources.router)
app.include_router(conversation.router)
app.include_router(downloads.router)
app.include_router(profiling.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "YourAnalyst API"}


@app.get("/")
async def root():
    return {
        "message": "YourAnalyst API is running!",
        "documentation": "/docs",
        "health": "/health"
    }
