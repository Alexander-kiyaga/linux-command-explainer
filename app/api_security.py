"""Small, shared HTTP boundary for the three text-only Gemini endpoints."""

import logging

from flask import jsonify, request

from app.explainer import GeminiAppError

logger = logging.getLogger(__name__)

AI_PATHS = frozenset({"/api/explain", "/api/task-builder/plan", "/api/bash/explain"})

PUBLIC_ERRORS = {
    "api_key_missing": (503, "The AI service is not configured."),
    "api_key_invalid": (401, "The AI service is unavailable due to a configuration issue."),
    "daily_quota_exhausted": (429, "The AI service's daily quota is exhausted. Please try again later."),
    "rate_limit_minute": (429, "The AI service is temporarily rate limited. Please try again later."),
    "quota_rate_limit_unknown": (429, "The AI service's quota or rate limit was reached. Please try again later."),
    "server_overloaded": (503, "The AI service is temporarily unavailable. Please try again."),
    "timeout": (504, "The AI service timed out. Please try again."),
    "permission_denied": (403, "The AI service is unavailable due to a configuration issue."),
    "parse_error": (502, "The AI response could not be validated. Please try again."),
    "service_error": (502, "The AI service is unavailable. Please try again."),
    "client_error": (400, "The AI request could not be completed."),
    "validation_error": (400, "Input is invalid or exceeds the maximum allowed length."),
}


def error_json(code: str, message: str, status: int):
    return jsonify({"success": False, "error": code, "message": message}), status


def read_text_request(field: str, max_body_bytes: int, *, exact_keys: bool = True):
    """Return (text, error response) without forwarding malformed or large JSON."""
    if not request.is_json:
        return None, error_json("invalid_request", f"Provide a JSON object with a text '{field}' field.", 400)
    if request.content_length is not None and request.content_length > max_body_bytes:
        return None, error_json("invalid_request", "Request body is too large.", 413)
    # Flask's MAX_CONTENT_LENGTH is a second, application-wide bound for
    # bodies without a usable Content-Length header.
    body = request.get_data(cache=True)
    if len(body) > max_body_bytes:
        return None, error_json("invalid_request", "Request body is too large.", 413)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or field not in payload or not isinstance(payload[field], str) or \
            (exact_keys and set(payload) != {field}):
        return None, error_json("invalid_request", f"Provide a JSON object with a text '{field}' field.", 400)
    return payload[field], None


def public_gemini_error(error: GeminiAppError):
    """Never expose provider messages, exception text, or arbitrary details."""
    code = error.error_code if error.error_code in PUBLIC_ERRORS else "service_error"
    status, message = PUBLIC_ERRORS[code]
    logger.warning("Gemini request failed [path=%s, code=%s, type=%s]", request.path, code, type(error).__name__)
    payload = {"success": False, "error": code, "message": message}
    if code == "daily_quota_exhausted":
        quota = error.details.get("quota_value") if isinstance(error.details, dict) else None
        if isinstance(quota, str) and quota.isascii() and quota.isdecimal() and len(quota) <= 6:
            payload["details"] = {"quota_value": quota}
    return jsonify(payload), status


def public_internal_error(error: Exception):
    logger.error("AI endpoint fault [path=%s, type=%s]", request.path, type(error).__name__)
    return error_json("internal_error", "The AI service is unavailable right now.", 500)
