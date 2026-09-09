import json
from pathlib import Path
from flask import Blueprint, jsonify, render_template, request

from app.config import Config
from app.explainer import (
    ApiKeyMissingError,
    ExplanationServiceError,
    InputValidationError,
    explain_command,
)

bp = Blueprint("main", __name__)

COMMANDS_FILE = Path(__file__).resolve().parent / "data" / "commands.json"


def load_commands_data():
    """Load the static commands dictionary from JSON file."""
    if not COMMANDS_FILE.exists():
        return []
    with open(COMMANDS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


@bp.route("/")
def index():
    """Render the single-page web interface."""
    return render_template(
        "index.html",
        api_key_configured=Config.is_api_key_configured(),
        gemini_model=Config.GEMINI_MODEL,
        max_input_length=Config.MAX_INPUT_LENGTH,
    )


@bp.route("/api/commands", methods=["GET"])
def get_commands():
    """Return the searchable list of common Linux commands grouped by category."""
    commands = load_commands_data()
    return jsonify({
        "success": True,
        "count": len(commands),
        "commands": commands,
    })


@bp.route("/api/explain", methods=["POST"])
def explain():
    """
    Explain a user-submitted Linux command.
    NEVER executes the submitted command.
    """
    if not request.is_json:
        return jsonify({
            "success": False,
            "error": "invalid_request",
            "message": "Request body must be valid JSON with a 'command' field.",
        }), 400

    payload = request.get_json(silent=True) or {}
    command_text = payload.get("command")

    if command_text is None:
        return jsonify({
            "success": False,
            "error": "invalid_request",
            "message": "Missing 'command' field in request body.",
        }), 400

    try:
        explanation = explain_command(str(command_text))
        return jsonify({
            "success": True,
            "data": explanation.model_dump(),
        }), 200

    except ApiKeyMissingError as e:
        return jsonify({
            "success": False,
            "error": "api_key_missing",
            "message": str(e),
        }), 503

    except InputValidationError as e:
        return jsonify({
            "success": False,
            "error": "validation_error",
            "message": str(e),
        }), 400

    except ExplanationServiceError as e:
        return jsonify({
            "success": False,
            "error": "service_error",
            "message": str(e),
        }), 502

    except Exception as e:
        return jsonify({
            "success": False,
            "error": "internal_error",
            "message": f"Unexpected server error: {e}",
        }), 500


@bp.route("/health", methods=["GET"])
def health():
    """Health check endpoint for local testing and EC2 load balancers."""
    return jsonify({
        "status": "ok",
        "api_key_configured": Config.is_api_key_configured(),
        "model": Config.GEMINI_MODEL,
    }), 200
