"""
Unit Tests with MOCKED Gemini AI Responses.
These tests run locally without network access or a real Gemini API key.
"""
import json
from unittest.mock import MagicMock, patch
import pytest

from app.config import Config
from app.explainer import (
    CommandExplanation,
    ExplanationServiceError,
    ImpactCategory,
    InputValidationError,
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
    long_input = "echo " + ("x" * 501)
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
# Mocked Explainer Service Tests
# ---------------------------------------------------------------------------

def test_explain_command_mocked_success(monkeypatch):
    """
    Test explain_command using a mocked Gemini client.
    Verifies timeout conversion, prompt encapsulation, and response parsing.
    """
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_valid_key_12345")

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

    # Setup mock SDK response
    mock_response = MagicMock()
    mock_response.text = json.dumps(mock_result_data)

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    with patch("google.genai.Client", return_value=mock_client) as mock_client_cls:
        result = explain_command("tar -czvf backup.tar.gz ./data")

        # Verify Client was created with millisecond timeout
        mock_client_cls.assert_called_once()
        _, kwargs = mock_client_cls.call_args
        assert kwargs["api_key"] == "mock_valid_key_12345"
        assert kwargs["http_options"].timeout == Config.API_TIMEOUT_MS

        # Verify generate_content called with prompt defense tags
        call_args, call_kwargs = mock_client.models.generate_content.call_args
        assert "<UNTRUSTED_COMMAND>" in call_kwargs["contents"]
        assert "tar -czvf backup.tar.gz ./data" in call_kwargs["contents"]

        # Verify returned object
        assert isinstance(result, CommandExplanation)
        assert result.summary == mock_result_data["summary"]
        assert result.impact == ImpactCategory.MODIFY
        assert len(result.breakdown) == 4


def test_explain_command_mocked_timeout(monkeypatch):
    """Test that a timeout exception from Gemini is caught and returns an ExplanationServiceError."""
    monkeypatch.setattr(Config, "GEMINI_API_KEY", "mock_valid_key_12345")

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = Exception("Deadline Exceeded: Client timeout")

    with patch("google.genai.Client", return_value=mock_client):
        with pytest.raises(ExplanationServiceError) as excinfo:
            explain_command("find / -name test")
        assert "timed out" in str(excinfo.value).lower()
