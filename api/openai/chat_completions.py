from http.server import BaseHTTPRequestHandler
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            self._send_json(503, {"error": "OPENAI_API_KEY is not configured."})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            payload = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return

        upstream_body = json.dumps(payload).encode("utf-8")
        request = Request(
            OPENAI_CHAT_URL,
            data=upstream_body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

        try:
            with urlopen(request, timeout=45) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")
                self.send_response(response.status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            error_body = error.read().decode("utf-8", errors="ignore")
            self._send_json(error.code, {"error": "OpenAI chat request failed", "details": error_body})
        except URLError as error:
            self._send_json(502, {"error": "Failed to reach OpenAI", "details": str(error)})
