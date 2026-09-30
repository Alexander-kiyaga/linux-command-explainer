from flask import Flask, request
from werkzeug.exceptions import RequestEntityTooLarge
from app.config import Config
from app.api_security import AI_PATHS, error_json


CONTENT_SECURITY_POLICY = "; ".join((
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "worker-src 'self'",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "form-action 'self'",
))


def create_app(test_config=None):
    """Application factory for LinuxLab AI."""
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["MAX_CONTENT_LENGTH"] = Config.MAX_REQUEST_BYTES

    if test_config is not None:
        app.config.from_mapping(test_config)

    @app.after_request
    def security_headers(response):
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(error):
        if request.path in AI_PATHS:
            return error_json("invalid_request", "Request body is too large.", 413)
        return error

    from app.routes import bp
    app.register_blueprint(bp)

    return app
