"""
Unit Tests with MOCKED Gemini AI Responses.
These tests run locally without network access or a real Gemini API key.
"""
import json
import logging
from unittest.mock import MagicMock, patch
import pytest

from google.genai import errors, types
from app.config import Config
from app.explainer import (
    ApiKeyInvalidError,
    ClientPermissionError,
    CommandExplanation,
    DailyQuotaExhaustedError,
    ExplanationServiceError,
    ExplanationTimeoutError,
    ImpactCategory,
    InputValidationError,
    QuotaRateLimitUnknownError,
    RateLimitMinuteError,
    ServiceOverloadedError,
    StructuredOutputParseError,
    TokenBreakdown,
    explain_command,
    sanitize_input,
)


# ---------------------------------------------------------------------------
# Input Validation & Sanitization Tests
# ---------------------------------------------------------------------------

def test_sanitize_input_valid():
    """Test valid command sanitization."""
    raw = "   ls -lah /var/log   \n"
    assert sanitize_input(raw) == "ls -lah /var/log"


def test_sanitize_input_empty():
    """Test empty input raises InputValidationError."""
    with pytest.raises(InputValidationError):
        sanitize_input("")
    with pytest.raises(InputValidationError):
        sanitize_input("    \n\t")


def test_sanitize_input_too_long():
    """Test overly long input raises InputValidationError."""
    long_input = "echo " + ("x" * (Config.MAX_INPUT_LENGTH + 1))
    with pytest.raises(InputValidationError) as excinfo:
        sanitize_input(long_input)
    assert "maximum" in str(excinfo.value).lower()


# ---------------------------------------------------------------------------
# Pydantic Schema & Impact Classification Tests
# ---------------------------------------------------------------------------

def test_pydantic_schema_validation_read():
    """Test that schema parses a read command explanation."""
    mock_json = {
        "is_valid_command": True,
        "summary": "Lists directory contents in detailed long format.",
        "impact": "read",
        "impact_explanation": "Reads directory metadata without changing files. Note that reading sensitive files has security implications.",
        "breakdown": [
            {"token": "ls", "token_type": "command", "explanation": "List directory contents."},
            {"token": "-lah", "token_type": "option", "explanation": "Show all files including hidden, long format, human-readable sizes."}
        ],
        "common_options": [
            {"option": "-t", "explanation": "Sort by modification time."}
        ],
        "useful_examples": [
            {"command": "ls -lS", "explanation": "Sort files by file size."}
        ],
        "version_and_system_notes": "GNU ls (Linux) uses color by default on many distributions. BSD ls (macOS) requires -G.",
        "safety_warning": None
    }

    explanation = CommandExplanation.model_validate(mock_json)
    assert explanation.is_valid_command is True
    assert explanation.impact == ImpactCategory.READ
    assert len(explanation.breakdown) == 2
    assert explanation.safety_warning is None


def test_pydantic_schema_validation_destructive():
    """Test that schema parses a destructive command with caution warning."""
    mock_json = {
        "is_valid_command": True,
        "summary": "Forcefully and recursively removes a directory.",
        "impact": "delete",
        "impact_explanation": "Permanently deletes all files and folders in the target path.",
        "breakdown": [
            {"token": "rm", "token_type": "command", "explanation": "Remove files or directories."},
            {"token": "-rf", "token_type": "option", "explanation": "Recursively remove without prompting."}
        ],
        "common_options": [],
        "useful_examples": [],
        "version_and_system_notes": "Standard across Linux and BSD.",
        "safety_warning": "Extremely dangerous if run against root or important directories."
    }

    explanation = CommandExplanation.model_validate(mock_json)
    assert explanation.impact == ImpactCategory.DELETE
    assert explanation.safety_warning is not None


def test_pydantic_schema_validation_depends():
    """Test that schema parses an impact category of 'depends'."""
    mock_json = {
        "is_valid_command": True,
        "summary": "Streams and transforms text lines.",
        "impact": "depends",
        "impact_explanation": "Without -i it outputs to stdout (read-only); with -i it alters files in place.",
        "breakdown": [],
        "common_options": [],
        "useful_examples": [],
        "version_and_system_notes": "GNU sed allows -i without extension; BSD/macOS sed requires -i ''.",
        "safety_warning": None
    }

    explanation = CommandExplanation.model_validate(mock_json)
    assert explanation.impact == ImpactCategory.DEPENDS


# ---------------------------------------------------------------------------
# Mocked Explainer Success, Duration Logging & Thinking Level Tests
# ---------------------------------------------------------------------------

def test_explain_command_mocked_success_with_duration_logging(monkeypatch, caplog):
    """
    Test explain_command using a mocked Gemini client.
    Verifies timeout conversion, prompt encapsulation, thinking level config,
    max_output_tokens, and duration logging without exposing the API key.
    """
    secret_key = "AIzaSySecretTestKeyNotToBeLogged_999"
    monkeypatch.setattr(Config, "GEMINI_API_KEY", secret_key)
    monkeypatch.setattr(Config, "GEMINI_MODEL", "gemini-3.6-flash")
    monkeypatch.setattr(Config, "MAX_OUTPUT_TOKENS", 1200)

    mock_result_data = {
        "is_valid_command": True,
        "summary": "Creates a gzip-compressed tar archive of the specified data folder.",
        "impact": "modify",
        "impact_explanation": "Creates a new archive file on disk.",
        "breakdown": [
            {"token": "tar", "token_type": "command", "explanation": "Tape archive utility."},
            {"token": "-czvf", "token_type": "option", "explanation": "Create, gzip, verbose, file options."},
            {"token": "backup.tar.gz", "token_type": "operand", "explanation": "Name of output archive file."},
            {"token": "./data", "token_type": "operand", "explanation": "Source directory to archive."}
        ],
        "common_options": [
            {"option": "-x", "explanation": "Extract files from an archive."}
        ],
        "useful_examples": [
            {"command": "tar -tzvf backup.tar.gz", "explanation": "List archive contents without extracting."}
        ],
        "version_and_system_notes": "GNU tar is standard on Linux. macOS uses BSD tar which handles extended attributes differently.",
        "safety_warning": None
    }

    mock_response = MagicMock()
    mock_response.text = json.dumps(mock_result_data)
    mock_response.candidates = [MagicMock(finish_reason="STOP")]

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with caplog.at_level(logging.INFO):
        with patch("google.genai.Client", return_value=mock_client) as mock_client_cls:
            result = explain_command("tar -czvf backup.tar.gz ./data")

            # Verify Client was initialized with exactly 1 attempt (retry_options=None)
            mock_client_cls.assert_called_once()
            _, kwargs = mock_client_cls.call_args
            assert kwargs["api_key"] == secret_key
            assert kwargs["http_options"].timeout == Config.API_TIMEOUT_MS
            assert kwargs["http_options"].retry_options is None

            # Verify generate_content called with thinking_level=LOW for Gemini 3
            call_args, call_kwargs = mock_client.models.generate_content.call_args
            assert "<UNTRUSTED_COMMAND>" in call_kwargs["contents"]
            assert call_kwargs["config"].thinking_config.thinking_level == types.ThinkingLevel.LOW
            assert call_kwargs["config"].max_output_tokens == 1200

            # Verify returned object
            assert isinstance(result, CommandExplanation)
            assert result.summary == mock_result_data["summary"]

            # Verify safe duration logging: logs duration but NEVER the API key
            log_text = caplog.text
            assert "Gemini request completed in" in log_text
            assert secret_key not in log_text


# ---------------------------------------------------------------------------
# Structured Error Classification Tests
# ---------------------------------------------------------------------------

def test_explain_daily_quota_exhaustion_with_retry_delay(monkeypatch):
    """
    Test that a 429 daily quota error with a generic retryDelay ('3.5s')
    is correctly classified as DailyQuotaExhaustedError and extracts quotaValue,
    without treating the retryDelay as proof of quota reset.
    """
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_daily = {
        "error": {
            "code": 429,
            "message": "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' and limit 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'.",
            "status": "RESOURCE_EXHAUSTED",
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    "violations": [
                        {
                            "subject": "project:12345",
                            "description": "Quota exceeded for quota metric 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' and limit 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' of service 'generativelanguage.googleapis.com' for consumer 'project_number:12345'.",
                            "quotaValue": "20"
                        }
                    ]
                },
                {
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    "retryDelay": "3.5s"
                }
            ]
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ClientError(429, err_json_daily)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(DailyQuotaExhaustedError) as excinfo:
            explain_command("ls -la")

        err = excinfo.value
        assert err.error_code == "daily_quota_exhausted"
        assert err.http_status == 429
        assert err.details.get("quota_value") == "20"
        assert "20 requests/day" in err.message
        assert "Pacific Time" in err.message
        assert "retry delay" in err.message.lower()


def test_explain_rate_limit_minute(monkeypatch):
    """Test that a 429 per-minute rate limit error is classified as RateLimitMinuteError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_rpm = {
        "error": {
            "code": 429,
            "message": "Resource has been exhausted: GenerateRequestsPerMinute limit reached.",
            "status": "RESOURCE_EXHAUSTED",
            "details": []
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ClientError(429, err_json_rpm)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(RateLimitMinuteError) as excinfo:
            explain_command("ls -la")

        assert excinfo.value.error_code == "rate_limit_minute"
        assert excinfo.value.http_status == 429
        assert "per minute" in excinfo.value.message.lower() or "rate limit" in excinfo.value.message.lower()


def test_explain_quota_unknown_fallback(monkeypatch):
    """Test that a 429 without identifiable daily or per-minute metric falls back to QuotaRateLimitUnknownError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_unclassified = {
        "error": {
            "code": 429,
            "message": "Resource has been exhausted.",
            "status": "RESOURCE_EXHAUSTED",
            "details": []
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ClientError(429, err_json_unclassified)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(QuotaRateLimitUnknownError) as excinfo:
            explain_command("ls -la")

        assert excinfo.value.error_code == "quota_rate_limit_unknown"
        assert excinfo.value.http_status == 429


def test_explain_service_overloaded_503(monkeypatch):
    """Test that HTTP 503 / UNAVAILABLE raises ServiceOverloadedError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_503 = {
        "error": {
            "code": 503,
            "message": "The model is overloaded. Please try again later.",
            "status": "UNAVAILABLE"
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ServerError(503, err_json_503)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(ServiceOverloadedError) as excinfo:
            explain_command("df -h")

        assert excinfo.value.error_code == "server_overloaded"
        assert excinfo.value.http_status == 503
        assert "overloaded" in excinfo.value.message.lower()


def test_explain_504_deadline_exceeded(monkeypatch):
    """Test that HTTP 504 / DEADLINE_EXCEEDED raises ExplanationTimeoutError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_504 = {
        "error": {
            "code": 504,
            "message": "Deadline exceeded waiting for model response.",
            "status": "DEADLINE_EXCEEDED"
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ServerError(504, err_json_504)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(ExplanationTimeoutError) as excinfo:
            explain_command("ping 8.8.8.8")

        assert excinfo.value.error_code == "timeout"
        assert excinfo.value.http_status == 504


def test_explain_api_key_invalid(monkeypatch):
    """Test that an explicit API key invalid error raises ApiKeyInvalidError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "invalid_key")

    err_json_key = {
        "error": {
            "code": 400,
            "message": "API_KEY_INVALID: API key not valid. Please pass a valid API key.",
            "status": "INVALID_ARGUMENT"
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ClientError(400, err_json_key)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(ApiKeyInvalidError) as excinfo:
            explain_command("pwd")

        assert excinfo.value.error_code == "api_key_invalid"
        assert excinfo.value.http_status == 401


def test_explain_permission_denied_403(monkeypatch):
    """Test that a 403 permission denied error raises ClientPermissionError and not an invalid key error."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    err_json_403 = {
        "error": {
            "code": 403,
            "message": "Permission denied on resource project/my-project.",
            "status": "PERMISSION_DENIED"
        }
    }

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = errors.ClientError(403, err_json_403)

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(ClientPermissionError) as excinfo:
            explain_command("pwd")

        assert excinfo.value.error_code == "permission_denied"
        assert excinfo.value.http_status == 403


def test_explain_truncated_or_invalid_json(monkeypatch):
    """Test that a truncated or invalid JSON response raises StructuredOutputParseError without automatic retry."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_key")

    mock_response = MagicMock()
    mock_response.text = '{"summary": "Incomplete json string truncated here...'
    mock_response.candidates = [MagicMock(finish_reason="MAX_TOKENS")]

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(StructuredOutputParseError) as excinfo:
            explain_command("cat /dev/urandom")

        assert excinfo.value.error_code == "parse_error"
        assert excinfo.value.http_status == 502
        assert "cut short" in excinfo.value.message.lower() or "truncated" in excinfo.value.message.lower()
        # Verify only 1 attempt was made (no automatic retries)
        assert mock_client.models.generate_content.call_count == 1
