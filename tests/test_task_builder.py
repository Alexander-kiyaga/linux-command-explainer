"""Offline Task Builder schema, route, and mocked Gemini behavior tests."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app import create_app
from app.config import Config
from app.explainer import (
    ApiKeyMissingError, DailyQuotaExhaustedError, InputValidationError,
    RateLimitMinuteError, ServiceOverloadedError, StructuredOutputParseError,
    ExplanationServiceError,
)
from app.task_builder import TaskPlan, generate_task_plan, sanitize_task


@pytest.fixture
def client():
    app = create_app({"TESTING": True})
    with app.test_client() as test_client:
        yield test_client


VALID_PLAN = {
    "status": "ready", "summary": "Create a sample website file.", "assumptions": ["Work from your home directory."],
    "clarifying_question": None, "overall_warning": None,
    "steps": [
        {"command": "mkdir website", "purpose": "Create the directory", "explanation": "Makes a directory.",
         "expected_result": "A website directory exists.", "impact": "modify", "warning": None},
        {"command": "echo 'Hello World' > website/index.html", "purpose": "Write the page", "explanation": "Redirects text into a virtual file.",
         "expected_result": "The file contains Hello World.", "impact": "modify", "warning": "A real > redirect overwrites an existing file."},
    ],
}


def mock_response(data=VALID_PLAN, finish_reason="STOP"):
    return SimpleNamespace(text=json.dumps(data), candidates=[SimpleNamespace(finish_reason=finish_reason)])


def test_task_input_validation():
    assert sanitize_task("  create a file  ") == "create a file"
    for value in (None, 23, "", "  ", "x" * 501, "task\x00"):
        with pytest.raises(InputValidationError):
            sanitize_task(value)
    assert sanitize_task("First line\nSecond line") == "First line\nSecond line"


def test_plan_schema_and_clarification():
    assert TaskPlan.model_validate(VALID_PLAN).steps[0].command == "mkdir website"
    clarification = {"status": "needs_clarification", "summary": "More detail needed.", "assumptions": [],
                     "clarifying_question": "Which directory?", "overall_warning": None, "steps": []}
    assert TaskPlan.model_validate(clarification).steps == []
    for changes in (
        {"status": "ready", "steps": []},
        {"status": "needs_clarification", "steps": VALID_PLAN["steps"], "clarifying_question": "Which path?"},
        {"steps": VALID_PLAN["steps"] * 5},
        {"compatibility": "supported"},
    ):
        with pytest.raises(Exception):
            TaskPlan.model_validate({**VALID_PLAN, **changes})
    for command in ("echo x\nrm y", "", "echo \x00", "x" * 2049, "echo\u2028oops"):
        bad = {**VALID_PLAN, "steps": [{**VALID_PLAN["steps"][0], "command": command}]}
        with pytest.raises(Exception):
            TaskPlan.model_validate(bad)
    bad = {**VALID_PLAN, "steps": [{**VALID_PLAN["steps"][0], "playground_compatible": True}]}
    with pytest.raises(Exception):
        TaskPlan.model_validate(bad)


def test_generate_task_plan_single_mocked_call(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(Config, "GEMINI_MODEL", "gemini-3.6-flash")
    client = MagicMock()
    client.models.generate_content.return_value = mock_response()
    with patch("google.genai.Client", return_value=client) as make_client:
        cleaned, plan = generate_task_plan("  Make a website file  ")
    assert cleaned == "Make a website file"
    assert len(plan.steps) == 2
    make_client.assert_called_once()
    assert make_client.call_args.kwargs["http_options"].retry_options is None
    assert client.models.generate_content.call_count == 1
    request = client.models.generate_content.call_args.kwargs
    assert request["config"].response_schema is TaskPlan
    assert request["config"].max_output_tokens == Config.TASK_BUILDER_MAX_OUTPUT_TOKENS
    assert "Make a website file" in request["contents"]
    assert "playground_compatible" not in json.dumps(plan.model_dump())


def test_bad_model_output_fails_closed(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    for response in (
        SimpleNamespace(text="{broken", candidates=[]),
        mock_response({**VALID_PLAN, "steps": []}),
        mock_response({**VALID_PLAN, "steps": [{**VALID_PLAN["steps"][0], "compatibility": True}]}),
        mock_response(finish_reason="MAX_TOKENS"),
        SimpleNamespace(text="", candidates=[]),
    ):
        client = MagicMock()
        client.models.generate_content.return_value = response
        with patch("google.genai.Client", return_value=client):
            with pytest.raises(StructuredOutputParseError):
                generate_task_plan("Make a website file")


def test_missing_key_and_classified_failures(monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", None)
    with pytest.raises(ApiKeyMissingError):
        generate_task_plan("Make a website file")
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "test-key")
    errors = [
        (SimpleNamespace(code=429, status="RESOURCE_EXHAUSTED", message="GenerateRequestsPerDay limit", details={}), DailyQuotaExhaustedError),
        (SimpleNamespace(code=429, status="RESOURCE_EXHAUSTED", message="GenerateRequestsPerMinute limit", details={}), RateLimitMinuteError),
        (SimpleNamespace(code=503, status="UNAVAILABLE", message="overloaded", details={}), ServiceOverloadedError),
    ]
    for error, expected in errors:
        client = MagicMock()
        client.models.generate_content.side_effect = Exception(error.message)
        client.models.generate_content.side_effect.code = error.code
        client.models.generate_content.side_effect.status = error.status
        client.models.generate_content.side_effect.message = error.message
        client.models.generate_content.side_effect.details = error.details
        with patch("google.genai.Client", return_value=client):
            with pytest.raises(expected):
                generate_task_plan("Make a website file")


def test_plan_route_input_and_mocked_success(client):
    for payload in (None, {}, {"task": 4}, {"task": "x", "extra": 1}):
        response = client.post("/api/task-builder/plan", json=payload)
        assert response.status_code == 400
    response = client.post("/api/task-builder/plan", data="{" + "x" * 5000, content_type="application/json")
    assert response.status_code == 400
    with patch("app.routes.generate_task_plan", return_value=("Make a website file", TaskPlan.model_validate(VALID_PLAN))) as mocked:
        response = client.post("/api/task-builder/plan", json={"task": "Make a website file"})
    assert response.status_code == 200
    assert response.json["data"]["plan"]["steps"][0]["command"] == "mkdir website"
    assert "compatibility" not in response.json["data"]["plan"]["steps"][0]
    mocked.assert_called_once_with("Make a website file")
    html = client.get("/task-builder").get_data(as_text=True)
    assert "Task Builder | LinuxLab AI" in html
    assert 'href="/task-builder" aria-current="page"' in html
    assert 'src="/static/js/task-builder.js"' in html
    assert client.post("/api/task-builder/execute", json={"command": "pwd"}).status_code == 404


@pytest.mark.parametrize("error,status,code", [
    (DailyQuotaExhaustedError("Daily quota reached."), 429, "daily_quota_exhausted"),
    (RateLimitMinuteError("Try again shortly."), 429, "rate_limit_minute"),
    (ServiceOverloadedError("Service overloaded."), 503, "server_overloaded"),
    (StructuredOutputParseError("Invalid plan."), 502, "parse_error"),
    (ExplanationServiceError("Service unavailable."), 502, "service_error"),
])
def test_plan_route_service_errors(client, error, status, code):
    with patch("app.routes.generate_task_plan", side_effect=error):
        response = client.post("/api/task-builder/plan", json={"task": "Make a website file"})
    assert response.status_code == status
    assert response.json["success"] is False
    assert response.json["error"] == code
    assert response.json["message"] == error.message
