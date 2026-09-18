#!/usr/bin/env python3
"""Serve the existing decision dashboard and authorized report files on loopback."""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


DIST = (Path(__file__).resolve().parent.parent / "dist").resolve()
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def make_handler(reports: dict[str, Path], marketplace: str, display_name: str, created_at: str):
    manifest = {
        "marketplace": marketplace,
        "displayName": display_name,
        "reportCreatedAt": created_at,
        "reports": [
            {"kind": kind, "url": f"/api/report/{kind}", "fileName": f"api-{kind}.tsv"}
            for kind in reports
        ],
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self.send_error(403)
                return
            path = unquote(urlsplit(self.path).path)
            if path == "/api/manifest":
                body = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
                content_type = "application/json; charset=utf-8"
            elif path.startswith("/api/report/"):
                kind = path.removeprefix("/api/report/")
                report = reports.get(kind)
                if report is None:
                    self.send_error(404)
                    return
                body = report.read_bytes()
                content_type = "text/tab-separated-values; charset=utf-8"
            else:
                relative = path.lstrip("/") or "index.html"
                static_file = (DIST / relative).resolve()
                if not static_file.is_relative_to(DIST) or not static_file.is_file():
                    self.send_error(404)
                    return
                body = static_file.read_bytes()
                content_type = MIME.get(static_file.suffix.lower(), "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            # URLs and seller report contents must not appear in terminal logs.
            return

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planning-report", required=True, type=Path)
    parser.add_argument("--fee-preview-report", type=Path)
    parser.add_argument("--storage-report", type=Path)
    parser.add_argument("--products-report", type=Path)
    parser.add_argument("--marketplace", required=True, choices=("US", "CA", "UK", "DE"))
    parser.add_argument("--display-name", default="")
    parser.add_argument("--report-created-at", default="")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    if not (DIST / "index.html").is_file():
        parser.error("先构建 github-pages 前端，再启动本机决策看板。")
    reports = {"planning": args.planning_report}
    for kind, value in (
        ("fee-preview", args.fee_preview_report),
        ("storage", args.storage_report),
        ("products", args.products_report),
    ):
        if value is not None:
            reports[kind] = value
    reports = {kind: path.resolve(strict=True) for kind, path in reports.items()}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(
        reports, args.marketplace, args.display_name, args.report_created_at
    ))
    print(f"DECISION_DASHBOARD_URL=http://127.0.0.1:{server.server_port}/", flush=True)
    print(f"REPORT_SOURCES={','.join(reports)}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
