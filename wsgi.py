"""
WSGI entry point for Linux Command Explainer.
Supports both direct local execution (`python wsgi.py`) bound to 127.0.0.1,
and production WSGI servers like Gunicorn (`gunicorn wsgi:app`).
"""
import os
from app import create_app
from app.config import Config

app = create_app()

if __name__ == "__main__":
    host = "127.0.0.1"
    port = Config.PORT
    debug = Config.FLASK_DEBUG

    print("=" * 60)
    print("  🐧 Linux Command Explainer - Development Server")
    print(f"  Local Address: http://{host}:{port}")
    print(f"  Gemini Model:  {Config.GEMINI_MODEL}")
    print(f"  API Key:       {'Configured' if Config.is_api_key_configured() else 'Missing (Set GEMINI_API_KEY in .env)'}")
    print("=" * 60)

    app.run(host=host, port=port, debug=debug)
