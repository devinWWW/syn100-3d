from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv


OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT_SECONDS = 45.0

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="SYN100 Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_openai_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured on the server.")
    return api_key


def get_openai_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_openai_api_key()}",
        "Content-Type": "application/json",
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/openai/chat-completions")
async def openai_chat_completions(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{OPENAI_BASE_URL}/chat/completions",
                headers=get_openai_headers(),
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to reach OpenAI: {exc}") from exc

    if not response.is_success:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return response.json()


@app.post("/api/openai/audio-speech")
async def openai_audio_speech(payload: dict[str, Any]) -> Response:
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{OPENAI_BASE_URL}/audio/speech",
                headers=get_openai_headers(),
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to reach OpenAI: {exc}") from exc

    if not response.is_success:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return Response(content=response.content, media_type=response.headers.get("content-type", "audio/mpeg"))
