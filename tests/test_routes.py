import pytest
from app import create_app
from app.config import Config


@pytest.fixture
def client():
    """Create Flask test client configured for unit testing."""
    app = create_app({"TESTING": True})
    with app.test_client() as client:
        yield client


def test_index_route(client):
    """Test that the index route loads HTML containing the app title."""
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Linux Command Explainer" in html
    assert "Understand shell commands in plain English" in html
    assert "Safe: Never Executes Code" in html


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
    assert "API key is not configured" in data["message"]
