"""Nimmt Alarme von Alertmanager (Webhook) an und verschickt sie per Microsoft Graph.

Microsoft schaltet den Versand per SMTP mit Passwort ab; Graph mit App-Registrierung bleibt.
Die App darf per Application Access Policy nur als ALERT_FROM senden.

Umgebung: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, ALERT_FROM, ALERT_TO
Nur Standardbibliothek, damit das Image ohne Fremdpakete auskommt.
"""

import json
import os
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

TENANT = os.environ["GRAPH_TENANT_ID"]
CLIENT_ID = os.environ["GRAPH_CLIENT_ID"]
CLIENT_SECRET = os.environ["GRAPH_CLIENT_SECRET"]
MAIL_FROM = os.environ["ALERT_FROM"]
MAIL_TO = os.environ["ALERT_TO"]

_token = {"value": None, "expires": 0.0}


def access_token() -> str:
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    body = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        }
    ).encode()
    url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
    with urllib.request.urlopen(url, data=body, timeout=20) as resp:
        data = json.load(resp)
    _token["value"] = data["access_token"]
    _token["expires"] = time.time() + int(data.get("expires_in", 3600))
    return _token["value"]


def render(payload: dict) -> tuple[str, str]:
    status = "BEHOBEN" if payload.get("status") == "resolved" else "ALARM"
    alerts = payload.get("alerts", [])
    names = sorted({a.get("labels", {}).get("alertname", "?") for a in alerts})
    subject = f"[IDF Checkout] {status}: {', '.join(names)}"
    lines = []
    for a in alerts:
        summary = a.get("annotations", {}).get("summary") or a.get("labels", {}).get("alertname", "?")
        state = "behoben" if a.get("status") == "resolved" else "aktiv"
        lines.append(f"- {summary} ({state}, seit {a.get('startsAt', '?')})")
    lines.append("")
    lines.append("Überwachung auf app-nbg1 (Prometheus/Alertmanager).")
    return subject, "\n".join(lines)


def send(subject: str, text: str) -> None:
    message = {
        "message": {
            "subject": subject,
            "body": {"contentType": "Text", "content": text},
            "toRecipients": [{"emailAddress": {"address": MAIL_TO}}],
        },
        "saveToSentItems": False,
    }
    req = urllib.request.Request(
        f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(MAIL_FROM)}/sendMail",
        data=json.dumps(message).encode(),
        headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20):
        pass


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            send(*render(payload))
        except Exception as exc:  # Alertmanager wiederholt bei Fehlern selbst
            self.log_error("Versand fehlgeschlagen: %s", exc)
            self.send_response(502)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()

    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok\n")


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
