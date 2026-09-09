from flask import Flask
from app.config import Config


def create_app(test_config=None):
    """Application factory for Linux Command Explainer."""
    app = Flask(__name__, template_folder="templates", static_folder="static")

    if test_config is not None:
        app.config.from_mapping(test_config)

    from app.routes import bp
    app.register_blueprint(bp)

    return app
