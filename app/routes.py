import json
from pathlib import Path
from flask import Blueprint, jsonify, render_template, request

from app.config import Config
from app.task_builder import generate_task_plan
from app.explainer import (
    GeminiAppError,
    ApiKeyMissingError,
    ApiKeyInvalidError,
    DailyQuotaExhaustedError,
    RateLimitMinuteError,
    QuotaRateLimitUnknownError,
    ServiceOverloadedError,
    ExplanationTimeoutError,
    StructuredOutputParseError,
    ClientPermissionError,
    InputValidationError,
    ExplanationServiceError,
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
    """Render the LinuxLab AI home page."""
    return render_template(
        "index.html",
        active_page="home",
        api_key_configured=Config.is_api_key_configured(),
    )


@bp.route("/explain")
def explain_page():
    """Render the existing command explainer within the shared site layout."""
    return render_template(
        "explain.html",
        active_page="explain",
        api_key_configured=Config.is_api_key_configured(),
        gemini_model=Config.GEMINI_MODEL,
        max_input_length=Config.MAX_INPUT_LENGTH,
    )


@bp.route("/playground")
def playground_page():
    """Render the browser-only learning simulation."""
    return render_template(
        "playground.html",
        active_page="playground",
        api_key_configured=Config.is_api_key_configured(),
    )


@bp.route("/missions")
def missions_page():
    """Render the browser-only deterministic Missions experience."""
    return render_template(
        "missions.html",
        active_page="missions",
        api_key_configured=Config.is_api_key_configured(),
    )


@bp.route("/task-builder")
def task_builder_page():
    """Render the educational AI task planning page."""
    return render_template(
        "task_builder.html", active_page="task_builder",
        api_key_configured=Config.is_api_key_configured(),
    )


@bp.route("/api/task-builder/plan", methods=["POST"])
def task_builder_plan():
    """Generate a plan as text only. No command is executed or checked here."""
    if not request.is_json or (request.content_length is not None and request.content_length > 4096):
        return jsonify({"success": False, "error": "invalid_request", "message": "Provide a small JSON body with a task field."}), 400
    if len(request.get_data(cache=True)) > 4096:
        return jsonify({"success": False, "error": "invalid_request", "message": "Request body is too large."}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) != {"task"} or not isinstance(payload["task"], str):
        return jsonify({"success": False, "error": "invalid_request", "message": "Provide a text task field."}), 400
    try:
        cleaned, plan = generate_task_plan(payload["task"])
        return jsonify({"success": True, "data": {"task": cleaned, "plan": plan.model_dump()}}), 200
    except GeminiAppError as error:
        response = {"success": False, "error": error.error_code, "message": error.message}
        if error.details:
            response["details"] = error.details
        return jsonify(response), error.http_status
    except Exception:
        return jsonify({"success": False, "error": "internal_error", "message": "Task planning is unavailable right now."}), 500


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

    except GeminiAppError as e:
        response_payload = {
            "success": False,
            "error": e.error_code,
            "message": e.message,
        }
        if e.details:
            response_payload["details"] = e.details
        return jsonify(response_payload), e.http_status

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
