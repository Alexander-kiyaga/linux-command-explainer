from unittest.mock import patch
import pytest

from app import create_app
from app.config import Config
from app.explainer import (
    ApiKeyInvalidError,
    ClientPermissionError,
    CommandExplanation,
    DailyQuotaExhaustedError,
    ExplanationTimeoutError,
    QuotaRateLimitUnknownError,
    RateLimitMinuteError,
    ServiceOverloadedError,
    StructuredOutputParseError,
)


@pytest.fixture
def client():
    """Create Flask test client configured for unit testing."""
    app = create_app({"TESTING": True})
    with app.test_client() as client:
        yield client


def test_index_route(client):
    """Home introduces LinuxLab AI and links to the working Explain page."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Home | LinuxLab AI" in html
    assert 'href="/" aria-current="page"' in html
    assert 'href="/explain"' in html
    assert 'href="/playground"' in html
    assert "Start with Explain" in html
    assert "Task Builder" in html
    assert "Playground" in html
    assert "Missions" in html
    assert "Bash" in html
    assert "Explain, Playground and Missions are available now." in html
    assert "Task Builder and Bash are planned for later phases." in html
    assert 'id="explain-form"' not in html


def test_explain_page_preserves_existing_interface(client):
    """Explain remains available with its form, examples, results, and dictionary."""
    response = client.get("/explain")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Explain | LinuxLab AI" in html
    assert 'href="/explain" aria-current="page"' in html
    assert 'href="/"' in html
    assert 'id="explain-form"' in html
    assert 'id="command-input"' in html
    assert 'id="results-card"' in html
    assert 'id="dictionary-grid"' in html
    assert "Safe: Never Executes Code" not in html
    assert "Explain Never Executes Code" in html
    assert 'src="/static/js/explain.js"' in html
    assert client.get("/static/js/explain.js").status_code == 200


def test_missions_page_is_browser_only_and_navigation_is_visible(client):
    response = client.get("/missions")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'href="/missions" aria-current="page"' in html
    assert 'src="/static/js/missions.js"' in html
    assert "Learning simulation" in html
    assert "Completion is checked from virtual files" in html
    assert client.get("/static/js/missions.js").status_code == 200
    assert client.post("/api/missions/execute", json={"command": "pwd"}).status_code == 404
    assert client.post("/api/missions/grade", json={}).status_code == 404
    home = client.get("/").get_data(as_text=True)
    assert 'href="/missions"' in home
    assert "Open Missions" in home


def test_playground_page_is_browser_only_simulation(client):
    response = client.get("/playground")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Playground | LinuxLab AI" in html
    assert 'href="/playground" aria-current="page"' in html
    assert 'id="terminal-form"' in html
    assert 'id="terminal-output"' in html
    assert "Learning simulation" in html
    assert "not a full Bash terminal" in html
    assert "Browser-only simulation" in html
    assert "Gemini Connected" not in html
    assert 'id="reset-confirm"' in html
    assert 'src="/static/js/playground.js"' in html
    assert client.get("/static/js/playground.js").status_code == 200
    assert client.get("/static/js/simulation/engine.js").status_code == 200
    assert client.post("/api/playground/execute", json={"command": "pwd"}).status_code == 404


def test_explain_page_shows_missing_key_guidance(client, monkeypatch):
    monkeypatch.setattr(Config, "GEMINI_API_KEY", None)
    html = client.get("/explain").get_data(as_text=True)
    assert "Gemini API Key Needed for Live AI Explanations" in html
    assert 'id="api-key-banner" class="alert-banner alert-warning "' in html


def test_health_route(client):
    """Test the /health monitoring endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert "api_key_configured" in data
    assert "model" in data


def test_get_commands_api(client):
    """Test the /api/commands endpoint returns the full dictionary."""
    response = client.get("/api/commands")
    assert response.status_code == 200
    data = response.get_json()
    assert data["success"] is True
    assert data["count"] >= 30
    assert isinstance(data["commands"], list)
    first_cmd = data["commands"][0]
    assert "name" in first_cmd
    assert "category" in first_cmd
    assert "impact" in first_cmd


def test_explain_without_json(client):
    """Test that non-JSON requests are rejected with 400."""
    response = client.post("/api/explain", data="command=ls", content_type="application/x-www-form-urlencoded")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"] == "invalid_request"


def test_explain_missing_command_field(client):
    """Test that requests lacking the 'command' key are rejected with 400."""
    response = client.post("/api/explain", json={"wrong_key": "ls"})
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"] == "invalid_request"


def test_explain_empty_command(client):
    """Test that empty or whitespace commands return a validation error."""
    response = client.post("/api/explain", json={"command": "   "})
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"] == "validation_error"


def test_explain_oversized_command(client):
    """Test that commands exceeding MAX_INPUT_LENGTH return a validation error."""
    oversized = "ls " + "a" * (Config.MAX_INPUT_LENGTH + 10)
    response = client.post("/api/explain", json={"command": oversized})
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"] == "validation_error"
    assert "maximum" in data["message"].lower()


def test_explain_api_key_missing(client, monkeypatch):
    """
    Test that when GEMINI_API_KEY is not configured,
    the endpoint returns 503 with an honest api_key_missing error code.
    It MUST NOT present fake responses as AI-generated.
    """
    monkeypatch.setattr(Config, "GEMINI_API_KEY", None)
    response = client.post("/api/explain", json={"command": "tar -czvf test.tar.gz ./data"})
    assert response.status_code == 503
    data = response.get_json()
    assert data["success"] is False
    assert data["error"] == "api_key_missing"
    assert "not configured" in data["message"].lower()


def test_explain_success_contract_is_unchanged(client):
    explanation = CommandExplanation.model_validate({
        "is_valid_command": True,
        "summary": "Lists files in long format.",
        "impact": "read",
        "impact_explanation": "Reads directory entries without changing them.",
        "breakdown": [{"token": "ls", "token_type": "command", "explanation": "Lists files."}],
        "common_options": [],
        "useful_examples": [],
        "version_and_system_notes": "Output can vary by system.",
        "safety_warning": None,
    })
    with patch("app.routes.explain_command", return_value=explanation) as mocked:
        response = client.post("/api/explain", json={"command": "ls -l"})

    assert response.status_code == 200
    assert response.get_json() == {"success": True, "data": explanation.model_dump()}
    mocked.assert_called_once_with("ls -l")


def test_route_daily_quota_exhausted(client):
    """Test route returns HTTP 429 for DailyQuotaExhaustedError."""
    with patch("app.routes.explain_command", side_effect=DailyQuotaExhaustedError("Daily limit reached", "20")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 429
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "daily_quota_exhausted"
        assert data["details"]["quota_value"] == "20"


def test_route_rate_limit_minute(client):
    """Test route returns HTTP 429 for RateLimitMinuteError."""
    with patch("app.routes.explain_command", side_effect=RateLimitMinuteError("Minute limit reached")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 429
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "rate_limit_minute"


def test_route_quota_rate_limit_unknown(client):
    """Test route returns HTTP 429 for QuotaRateLimitUnknownError."""
    with patch("app.routes.explain_command", side_effect=QuotaRateLimitUnknownError("Quota error")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 429
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "quota_rate_limit_unknown"


def test_route_server_overloaded(client):
    """Test route returns HTTP 503 for ServiceOverloadedError."""
    with patch("app.routes.explain_command", side_effect=ServiceOverloadedError("Server overloaded")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 503
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "server_overloaded"


def test_route_timeout_504(client):
    """Test route returns HTTP 504 for ExplanationTimeoutError."""
    with patch("app.routes.explain_command", side_effect=ExplanationTimeoutError("Request timed out")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 504
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "timeout"


def test_route_api_key_invalid(client):
    """Test route returns HTTP 401 for ApiKeyInvalidError."""
    with patch("app.routes.explain_command", side_effect=ApiKeyInvalidError("Invalid key")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 401
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "api_key_invalid"


def test_route_permission_denied(client):
    """Test route returns HTTP 403 for ClientPermissionError."""
    with patch("app.routes.explain_command", side_effect=ClientPermissionError("Forbidden")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 403
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "permission_denied"


def test_route_parse_error(client):
    """Test route returns HTTP 502 for StructuredOutputParseError."""
    with patch("app.routes.explain_command", side_effect=StructuredOutputParseError("Output truncated")):
        response = client.post("/api/explain", json={"command": "ls -la"})
        assert response.status_code == 502
        data = response.get_json()
        assert data["success"] is False
        assert data["error"] == "parse_error"
