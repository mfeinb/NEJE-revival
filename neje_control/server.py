"""Dependency-light localhost web server for NEJE Revival."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import urllib.parse
import webbrowser

from .bitmap import BitmapError
from .protocols import ProtocolError
from .service import ControllerService, SerialUnavailable, ServiceError


WEB_ROOT = Path(__file__).with_name("web")
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class AppHandler(SimpleHTTPRequestHandler):
    service: ControllerService
    server_version = "NEJE-Revival/0.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ServiceError("invalid Content-Length") from exc
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ServiceError("request body is empty or too large")
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError("request body must be valid JSON") from exc
        if not isinstance(value, dict):
            raise ServiceError("request body must be a JSON object")
        return value

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urllib.parse.urlsplit(origin)
        return parsed.hostname in {"127.0.0.1", "localhost", "::1"}

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path == "/api/ports":
                self._json(HTTPStatus.OK, {"ports": self.service.ports()})
            elif path == "/api/protocols":
                self._json(HTTPStatus.OK, {"protocols": self.service.protocols()})
            elif path == "/api/status":
                self._json(HTTPStatus.OK, self.service.status())
            else:
                if path == "/":
                    self.path = "/index.html"
                super().do_GET()
        except (ServiceError, SerialUnavailable) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def do_POST(self) -> None:
        if not self._same_origin():
            self._json(HTTPStatus.FORBIDDEN, {"error": "cross-origin requests are not allowed"})
            return
        path = urllib.parse.urlsplit(self.path).path
        try:
            body = self._body()
            if path == "/api/connect":
                result = self.service.connect(body.get("port", ""), body.get("protocol", ""))
                self._json(HTTPStatus.OK, result)
            elif path == "/api/disconnect":
                self.service.disconnect()
                self._json(HTTPStatus.OK, self.service.status())
            elif path == "/api/action":
                self.service.action(
                    body.get("action", ""),
                    body.get("parameters", {}),
                    bool(body.get("safety_acknowledged")),
                )
                self._json(HTTPStatus.OK, self.service.status())
            elif path == "/api/jobs":
                self.service.start_job(body, safety_acknowledged=bool(body.get("safety_acknowledged")))
                self._json(HTTPStatus.ACCEPTED, self.service.status())
            elif path == "/api/prepare":
                self.service.prepare_job(body)
                self._json(HTTPStatus.ACCEPTED, self.service.status())
            else:
                self._json(HTTPStatus.NOT_FOUND, {"error": "unknown API endpoint"})
        except (BitmapError, ProtocolError, SerialUnavailable, ServiceError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"unexpected error: {exc}"})


def build_server(host: str, port: int, service: ControllerService | None = None) -> ThreadingHTTPServer:
    handler = type("BoundAppHandler", (AppHandler,), {"service": service or ControllerService()})
    return ThreadingHTTPServer((host, port), handler)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the NEJE Revival local controller")
    parser.add_argument("--host", default="127.0.0.1", help="listen address (default: localhost only)")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser automatically")
    args = parser.parse_args(argv)
    server = build_server(args.host, args.port)
    shown_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
    url = f"http://{shown_host}:{server.server_port}/"
    print(f"NEJE Revival is running at {url}")
    print("Press Ctrl-C to stop. Keep the engraver's physical power switch within reach.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping NEJE Revival.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
