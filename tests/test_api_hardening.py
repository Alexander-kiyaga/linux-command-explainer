"""Offline checks for the public AI HTTP boundary and production controls."""

import logging
from pathlib import Path
from unittest.mock import patch

import pytest

from app import CONTENT_SECURITY_POLICY, create_app
from app.api_security import PUBLIC_ERRORS
from app.config import Config, bounded_float, bounded_int
from app.explainer import DailyQuotaExhaustedError, GeminiAppError, classify_gemini_error


ENDPOINTS = (
    ("/api/explain", "command", "app.routes.explain_command", 10000),
    ("/api/task-builder/plan", "task", "app.routes.generate_task_plan", 4096),
    ("/api/bash/explain", "script", "app.routes.explain_script", 10000),
)
SECRET = "SENTINEL_PROVIDER_SECRET_123"


@pytest.fixture
def client():
    with create_app({"TESTING": True}).test_client() as test_client:
        yield test_client


@pytest.mark.parametrize("path,field,service,max_bytes", ENDPOINTS)
def test_ai_routes_reject_malformed_types_and_sizes(client, path, field, service, max_bytes):
    malformed = (
        ("[1]", "application/json"),
        ('{"' + field + '":', "application/json"),
        ("not json", "text/plain"),
    )
    with patch(service) as mocked:
        for body, mime in malformed:
            response = client.post(path, data=body, content_type=mime)
            assert response.status_code == 400
            assert response.json["error"] == "invalid_request"
        for value in ([], ["ls"], {"nested": "ls"}, 12, True, None):
            response = client.post(path, json={field: value})
            assert response.status_code == 400
            assert response.json["error"] == "invalid_request"
        assert client.post(path, json={field: "x" * (max_bytes + 1)}).status_code == 413
        assert client.post(path, data=b"x" * (Config.MAX_REQUEST_BYTES + 1), content_type="application/json").status_code == 413
        mocked.assert_not_called()
    blank = client.post(path, json={field: " "})
    assert blank.status_code == 400
    assert blank.json["error"] == "validation_error"
    logical_limit = 4096 if field == "script" else 500
    overlong = client.post(path, json={field: "x" * (logical_limit + 1)})
    assert overlong.status_code == 400
    assert overlong.json["error"] == "validation_error"


def test_explain_requires_string(client):
    with patch("app.routes.explain_command") as mocked:
        assert client.post("/api/explain", json=[{"command": "ls"}]).status_code == 400
        assert client.post("/api/explain", json={"command": {"text": "ls"}}).status_code == 400
        mocked.assert_not_called()


@pytest.mark.parametrize("path,field,service,max_bytes", ENDPOINTS)
def test_sentinel_exception_and_provider_details_never_reach_response_or_logs(client, caplog, path, field, service, max_bytes):
    with caplog.at_level(logging.WARNING):
        with patch(service, side_effect=Exception(SECRET)):
            response = client.post(path, json={field: "ls"})
        assert response.status_code == 500
        assert response.json["error"] == "internal_error"
        assert SECRET not in response.get_data(as_text=True)
        assert SECRET not in caplog.text

        caplog.clear()
        provider = GeminiAppError(SECRET, "service_error", 502, {"unsafe": SECRET})
        with patch(service, side_effect=provider):
            response = client.post(path, json={field: "ls"})
        assert response.status_code == 502
        assert response.json["message"] == PUBLIC_ERRORS["service_error"][1]
        assert SECRET not in response.get_data(as_text=True)
        assert SECRET not in caplog.text

        caplog.clear()
        quota = DailyQuotaExhaustedError(SECRET, SECRET)
        with patch(service, side_effect=quota):
            response = client.post(path, json={field: "ls"})
        assert response.status_code == 429
        assert "details" not in response.json
        assert SECRET not in response.get_data(as_text=True)
        assert SECRET not in caplog.text


def test_raw_provider_messages_are_sanitized_before_classification():
    for code, status in ((403, "PERMISSION_DENIED"), (400, "INVALID_ARGUMENT"), (500, "INTERNAL")):
        upstream = Exception(SECRET)
        upstream.code, upstream.status, upstream.message = code, status, SECRET
        upstream.details = {"secret": SECRET}
        classified = classify_gemini_error(upstream)
        assert SECRET not in classified.message


@pytest.mark.parametrize("path", ("/", "/explain", "/playground", "/missions", "/task-builder", "/bash", "/static/js/bash/worker.js"))
def test_security_headers_on_pages_and_static(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    assert "worker-src 'self'" in response.headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in response.headers["Content-Security-Policy"].split("script-src ", 1)[1].split(";", 1)[0]
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" not in response.headers


@pytest.mark.parametrize("path,field,service,max_bytes", ENDPOINTS)
def test_security_headers_on_ai_api_errors(client, path, field, service, max_bytes):
    response = client.post(path, json={field: []})
    assert response.status_code == 400
    assert response.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    oversized = client.post(path, data=b"x" * (Config.MAX_REQUEST_BYTES + 1), content_type="application/json")
    assert oversized.status_code == 413
    assert oversized.headers["Content-Security-Policy"] == CONTENT_SECURITY_POLICY


def test_operational_config_bounds(monkeypatch):
    for name, default, minimum, maximum in (
        ("MAX_INPUT_LENGTH", 500, 1, 1000),
        ("MAX_OUTPUT_TOKENS", 1500, 128, 8192),
        ("TASK_BUILDER_MAX_OUTPUT_TOKENS", 3000, 256, 8192),
        ("BASH_MAX_OUTPUT_TOKENS", 4000, 256, 8192),
        ("PORT", 5000, 1, 65535),
    ):
        with monkeypatch.context() as env:
            env.setenv(name, str(minimum))
            assert bounded_int(name, default, minimum, maximum) == minimum
            for invalid in ("bad", "0", str(maximum + 1)):
                env.setenv(name, invalid)
                with pytest.raises(ValueError):
                    bounded_int(name, default, minimum, maximum)
    with monkeypatch.context() as env:
        for invalid in ("bad", "nan", "inf", "0", "61"):
            env.setenv("API_TIMEOUT_SECONDS", invalid)
            with pytest.raises(ValueError):
                bounded_float("API_TIMEOUT_SECONDS", 15, 1, 60)
    assert create_app().config["MAX_CONTENT_LENGTH"] == 16 * 1024


def test_production_ai_limits_cover_only_gemini_endpoints():
    aws = Path(__file__).resolve().parent.parent / "infrastructure" / "aws"
    deploy = (aws / "deploy.yml").read_text()
    nginx = (aws / "templates" / "nginx.conf.j2").read_text()
    assert "location ~ ^/api/(explain|task-builder/plan|bash/explain)$" in nginx
    assert "limit_req zone=ai_per_ip" in nginx
    assert "limit_conn ai_concurrent" in nginx
    assert "limit_req_status 429;" in nginx
    assert "limit_conn_status 429;" in nginx
    assert '"error":"rate_limited"' in nginx
    assert '"error":"invalid_request"' in nginx
    assert "error_page 413 = @body_too_large;" in nginx
    assert "Retry-After 20" in nginx
    assert "add_header Content-Security-Policy" in nginx
    ordinary_location = nginx.split("location / {", 1)[1].split("}", 1)[0]
    assert "proxy_pass" in ordinary_location
    assert "limit_req" not in ordinary_location and "limit_conn" not in ordinary_location
    assert "ai_requests_per_minute: 6" in deploy
    assert "ai_max_inflight: 1" in deploy
    assert "certbot" not in deploy
