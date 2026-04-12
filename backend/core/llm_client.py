"""
LLM Client — Key-rotating interface to the Groq inference API.

Loads one or more Groq API keys from environment variables and cycles
through them transparently when rate-limit errors (HTTP 429) occur.
Callers never need to manage keys directly; the rotation is automatic.

Falls back to GROQ_API_KEY when the pooled GROQ_API_KEYS var is absent.
"""

from groq import Groq, RateLimitError
import os
import json
import time
import logging
import threading
import re
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

MODEL_RELIABILITY = "llama-3.1-8b-instant"
MODEL_ACCURACY = "llama-3.3-70b-versatile"

MODEL = MODEL_ACCURACY


class KeyRotator:
    """Manages a circular pool of API keys with thread-safe advancement.

    On encountering a rate-limit rejection the pool index moves forward,
    giving subsequent requests a fresh quota bucket automatically.
    """

    def __init__(self):
        keys_csv = os.getenv("GROQ_API_KEYS", "")
        if keys_csv:
            self._keys = [k.strip() for k in keys_csv.split(",") if k.strip()]
        else:
            single = os.getenv("GROQ_API_KEY", "")
            self._keys = [single] if single else []

        if not self._keys:
            raise RuntimeError(
                "No Groq API keys configured. "
                "Set GROQ_API_KEYS (comma-separated) or GROQ_API_KEY."
            )

        self._index = 0
        self._lock = threading.Lock()
        self._clients: dict[int, Groq] = {}
        logger.info("KeyRotator ready with %d key(s).", len(self._keys))

    @property
    def current_client(self) -> Groq:
        """Return the Groq client bound to the active key slot."""
        idx = self._index
        if idx not in self._clients:
            self._clients[idx] = Groq(api_key=self._keys[idx])
        return self._clients[idx]

    def rotate(self) -> bool:
        """Move to the next key in the ring. Returns False when fully cycled."""
        with self._lock:
            next_idx = (self._index + 1) % len(self._keys)
            if next_idx == 0:
                return False
            self._index = next_idx
            logger.warning(
                "Switched to API key %d/%d after hitting rate limit.",
                self._index + 1,
                len(self._keys),
            )
            return True

    @property
    def total_keys(self) -> int:
        return len(self._keys)


_pool = KeyRotator()


def _parse_json_block(text: str) -> str:
    """Locate and extract the first JSON object or array from raw LLM output."""
    text = text.strip()
    if text.startswith("```"):
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1:
        start = text.find("[")
        end = text.rfind("]")

    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]

    return text


def _sanitize_json(text: str) -> str:
    """Patch common JSON formatting mistakes produced by language models."""
    text = re.sub(r'\\(?![nrtbf"\\/])', r"\\\\", text)
    return text


def invoke_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1500,
    expect_json: bool = True,
    model: str = None,
):
    """Send a chat completion request with transparent key rotation on 429s.

    Parameters:
        system_prompt: Instructions provided in the system role.
        user_prompt:   The user-facing query or payload.
        temperature:   Controls randomness (0.0 = deterministic, 2.0 = creative).
        max_tokens:    Upper bound on generated tokens.
        expect_json:   When True, response is parsed and returned as a dict/list.
        model:         Override the default model selection.

    Returns:
        Parsed JSON structure when expect_json is set, otherwise the raw string.

    Raises:
        ValueError: When every key is exhausted or the output cannot be parsed.
    """
    selected_model = model or MODEL
    max_attempts = _pool.total_keys * 2
    original_user_prompt = user_prompt

    for attempt in range(max_attempts):
        try:
            resp = _pool.current_client.chat.completions.create(
                model=selected_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=30,
            )
            text = resp.choices[0].message.content.strip()

            if not expect_json:
                return text

            json_text = _parse_json_block(text)

            try:
                return json.loads(json_text)
            except json.JSONDecodeError:
                try:
                    cleaned_text = _sanitize_json(json_text)
                    return json.loads(cleaned_text)
                except json.JSONDecodeError:
                    raise

        except RateLimitError as e:
            logger.warning(
                "Rate limit on key %d/%d: %s",
                _pool._index + 1,
                _pool.total_keys,
                str(e)[:120],
            )
            rotated = _pool.rotate()
            if rotated:
                continue
            else:
                if attempt < max_attempts - 1:
                    time.sleep(3)
                    continue
                raise ValueError(
                    "All API keys have reached their rate limits. "
                    "Please wait a few minutes or add more keys to GROQ_API_KEYS."
                )

        except json.JSONDecodeError:
            if attempt < max_attempts - 1:
                user_prompt = (
                    original_user_prompt
                    + "\n\nReturn ONLY valid JSON. No preamble. No markdown."
                )
                continue
            raise ValueError("AI returned invalid format.")

        except Exception as e:
            raise ValueError("AI service error: {}".format(e))
