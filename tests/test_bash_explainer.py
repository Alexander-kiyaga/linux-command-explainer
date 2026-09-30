"""Offline, mocked checks for Bash text explanation and its API boundary."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app import create_app
from app.bash_explainer import BashExplanation, explain_script, sanitize_script
from app.config import Config
from app.explainer import (
    ApiKeyMissingError, DailyQuotaExhaustedError, InputValidationError,
    RateLimitMinuteError, ServiceOverloadedError, StructuredOutputParseError,
)

SCRIPT = '# virtual comment\nname="World"\necho "Hello $name"'
VALID_EXPLANATION = {
    "summary": "Prints a greeting in the virtual script example.",
    "lines": [
        {"line": 1, "explanation": "This line is a comment.", "concepts": ["comments"]},
        {"line": 2, "explanation": "This assigns a quoted string.", "concepts": ["variables", "quoting"]},
        {"line": 3, "explanation": "This expands a variable for echo.", "concepts": ["expansion", "echo"]},
    ],
    "unsupported_features": [], "caution": "This is an explanation, not an observed result.",
}


@pytest.fixture
def client():
    with create_app({"TESTING": True}).test_client() as test_client:
        yield test_client


def model_response(data=VALID_EXPLANATION, finish_reason="STOP"):
    return SimpleNamespace(text=json.dumps(data), candidates=[SimpleNamespace(finish_reason=finish_reason)])


def test_script_input_bounds_and_line_preservation():
    assert sanitize_script("a\r\nb") == "a\nb"
    assert sanitize_script(SCRIPT) == SCRIPT
    for source in (None, "", "   ", "x" * 4097, "x\n" * 60, "echo x\x00", "echo x\r", "\ud800"):
        with pytest.raises(InputValidationError):
            sanitize_script(source)


def test_strict_schema():
    assert len(BashExplanation.model_validate(VALID_EXPLANATION).lines) == 3
    for bad in (
        {**VALID_EXPLANATION, "compatible": True},
        {**VALID_EXPLANATION, "lines": []},
        {**VALID_EXPLANATION, "lines": [{**VALID_EXPLANATION["lines"][0], "ran": True}]},
        {**VALID_EXPLANATION, "summary": ""},
    ):
        with pytest.raises(Exception):
            BashExplanation.model_validate(bad)


def test_mocked_gemini_success(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    client = MagicMock()
    client.models.generate_content.return_value = model_response()
    with patch("google.genai.Client", return_value=client):
        cleaned, explanation = explain_script(SCRIPT)
    assert cleaned == SCRIPT
    assert [item.line for item in explanation.lines] == [1, 2, 3]
    assert client.models.generate_content.call_count == 1
    request = client.models.generate_content.call_args.kwargs
    assert request["config"].response_schema is BashExplanation
    assert request["config"].max_output_tokens == Config.BASH_MAX_OUTPUT_TOKENS
    assert "untrusted" in request["contents"]


def test_malformed_or_incomplete_response_fails_closed(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    responses = [
        SimpleNamespace(text="{broken", candidates=[]),
        model_response({**VALID_EXPLANATION, "lines": VALID_EXPLANATION["lines"][:-1]}),
        model_response({**VALID_EXPLANATION, "lines": [VALID_EXPLANATION["lines"][0]] * 3}),
        model_response({**VALID_EXPLANATION, "lines": [{**VALID_EXPLANATION["lines"][0], "playground_compatible": True}]}),
        model_response(finish_reason="MAX_TOKENS"),
        SimpleNamespace(text="", candidates=[]),
    ]
    for response in responses:
        client = MagicMock()
        client.models.generate_content.return_value = response
        with patch("google.genai.Client", return_value=client):
            with pytest.raises(StructuredOutputParseError):
                explain_script(SCRIPT)


def test_missing_key_quota_rate_and_service_errors(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", None)
    with pytest.raises(ApiKeyMissingError):
        explain_script(SCRIPT)
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    for code, status, message, expected in (
        (429, "RESOURCE_EXHAUSTED", "GenerateRequestsPerDay limit", DailyQuotaExhaustedError),
        (429, "RESOURCE_EXHAUSTED", "GenerateRequestsPerMinute limit", RateLimitMinuteError),
        (503, "UNAVAILABLE", "overloaded", ServiceOverloadedError),
    ):
        client = MagicMock()
        error = Exception(message)
        error.code, error.status, error.message, error.details = code, status, message, {}
        client.models.generate_content.side_effect = error
        with patch("google.genai.Client", return_value=client):
            with pytest.raises(expected):
                explain_script(SCRIPT)


def test_bash_page_and_api(client):
    html = client.get("/bash").get_data(as_text=True)
    assert "Bash | LinuxLab AI" in html
    assert 'href="/bash" aria-current="page"' in html
    assert 'src="/static/js/bash.js"' in html
    for payload in (None, {}, {"script": 3}, {"script": "x", "extra": 1}):
        assert client.post("/api/bash/explain", json=payload).status_code == 400
    assert client.post("/api/bash/explain", data="{" + "x" * 10001, content_type="application/json").status_code == 400
    with patch("app.routes.explain_script", return_value=(SCRIPT, BashExplanation.model_validate(VALID_EXPLANATION))) as mocked:
        response = client.post("/api/bash/explain", json={"script": SCRIPT})
    assert response.status_code == 200
    assert response.json["data"]["lines"][2]["line"] == 3
    mocked.assert_called_once_with(SCRIPT)
    assert client.post("/api/bash/run", json={"script": SCRIPT}).status_code == 404


@pytest.mark.parametrize("error,status,code", [
    (DailyQuotaExhaustedError("Daily quota reached."), 429, "daily_quota_exhausted"),
    (RateLimitMinuteError("Try again shortly."), 429, "rate_limit_minute"),
    (ServiceOverloadedError("Service overloaded."), 503, "server_overloaded"),
    (StructuredOutputParseError("Invalid response."), 502, "parse_error"),
])
def test_bash_api_classified_errors(client, error, status, code):
    with patch("app.routes.explain_script", side_effect=error):
        response = client.post("/api/bash/explain", json={"script": SCRIPT})
    assert response.status_code == status
    assert response.json["error"] == code
