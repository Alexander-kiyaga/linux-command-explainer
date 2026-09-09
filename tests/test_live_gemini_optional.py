"""
Optional Live Gemini API Integration Test.

DISTINCTION:
- This test calls the REAL Google Gemini API over the network.
- It is SKIPPED BY DEFAULT to prevent accidental API quota usage and to allow
  offline testing without an API key.
- To execute this live test after configuring your key in .env:
    RUN_REAL_GEMINI_TEST=1 pytest tests/test_live_gemini_optional.py -v
"""
import os
import pytest
from app.config import Config
from app.explainer import CommandExplanation, explain_command


@pytest.mark.skipif(
    os.getenv("RUN_REAL_GEMINI_TEST") != "1" or not Config.is_api_key_configured(),
    reason="Real Gemini API test skipped. To run: set RUN_REAL_GEMINI_TEST=1 and configure GEMINI_API_KEY in .env"
)
def test_real_gemini_api_call():
    """
    Live test against the actual Gemini model.
    Sends a simple command ('ls -la') and verifies the response meets schema constraints.
    """
    command = "ls -la /var/log"
    explanation = explain_command(command)

    assert isinstance(explanation, CommandExplanation)
    assert explanation.is_valid_command is True
    assert len(explanation.summary) > 10
    assert explanation.impact in ["read", "modify", "delete", "depends", "unknown"]
    assert len(explanation.breakdown) >= 1
    assert len(explanation.common_options) >= 1
    assert len(explanation.useful_examples) >= 1
    assert len(explanation.version_and_system_notes) > 0
