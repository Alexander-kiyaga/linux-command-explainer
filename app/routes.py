import json
from pathlib import Path
from flask import Blueprint, jsonify, render_template

from app.api_security import public_gemini_error, public_internal_error, read_text_request
from app.config import Config
from app.task_builder import generate_task_plan
from app.bash_explainer import explain_script
from app.explainer import GeminiAppError, explain_command

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


@bp.route("/bash")
def bash_page():
    """Render the browser-only Bash teaching simulation."""
    return render_template(
        "bash.html", active_page="bash",
        api_key_configured=Config.is_api_key_configured(),
    )


@bp.route("/api/bash/explain", methods=["POST"])
def bash_explain():
    """Explain script text with Gemini. This route has no script execution path."""
    script, error = read_text_request("script", 10000)
    if error:
        return error
    try:
        cleaned, explanation = explain_script(script)
        return jsonify({"success": True, "data": {"script": cleaned, **explanation.model_dump()}}), 200
    except GeminiAppError as exc:
        return public_gemini_error(exc)
    except Exception as exc:
        return public_internal_error(exc)


@bp.route("/api/task-builder/plan", methods=["POST"])
def task_builder_plan():
    """Generate a plan as text only. No command is executed or checked here."""
    task, error = read_text_request("task", 4096)
    if error:
        return error
    try:
        cleaned, plan = generate_task_plan(task)
        return jsonify({"success": True, "data": {"task": cleaned, "plan": plan.model_dump()}}), 200
    except GeminiAppError as exc:
        return public_gemini_error(exc)
    except Exception as exc:
        return public_internal_error(exc)


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
    command_text, error = read_text_request("command", 10000, exact_keys=False)
    if error:
        return error

    try:
        explanation = explain_command(command_text)
        return jsonify({
            "success": True,
            "data": explanation.model_dump(),
        }), 200

    except GeminiAppError as exc:
        return public_gemini_error(exc)
    except Exception as exc:
        return public_internal_error(exc)


@bp.route("/health", methods=["GET"])
def health():
    """Health check endpoint for local testing and EC2 load balancers."""
    return jsonify({
        "status": "ok",
        "api_key_configured": Config.is_api_key_configured(),
        "model": Config.GEMINI_MODEL,
    }), 200
