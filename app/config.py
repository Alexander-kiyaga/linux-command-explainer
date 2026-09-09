import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root if present
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")


class Config:
    """Application configuration loaded from environment variables."""

    # Raw API key with placeholder detection
    _raw_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    PLACEHOLDER_KEYS = {"", "your_gemini_api_key_here", "YOUR_GEMINI_API_KEY"}
    GEMINI_API_KEY = _raw_api_key if _raw_api_key not in PLACEHOLDER_KEYS else None

    # Model configuration - default to official balanced model gemini-2.5-flash
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

    # Timeouts: user specifies seconds, SDK requires milliseconds
    try:
        API_TIMEOUT_SECONDS = float(os.getenv("API_TIMEOUT_SECONDS", "15"))
    except ValueError:
        API_TIMEOUT_SECONDS = 15.0
    API_TIMEOUT_MS = int(API_TIMEOUT_SECONDS * 1000)

    # Security input constraints
    try:
        MAX_INPUT_LENGTH = int(os.getenv("MAX_INPUT_LENGTH", "500"))
    except ValueError:
        MAX_INPUT_LENGTH = 500

    # Configurable maximum output token limit (reduces bloat, does not guarantee complete response)
    try:
        MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "1500"))
    except ValueError:
        MAX_OUTPUT_TOKENS = 1500

    # Server settings
    try:
        PORT = int(os.getenv("PORT", "5000"))
    except ValueError:
        PORT = 5000

    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")

    @classmethod
    def is_api_key_configured(cls) -> bool:
        """Return True only if a real non-placeholder Gemini API key is configured."""
        return cls.GEMINI_API_KEY is not None and len(cls.GEMINI_API_KEY) > 0
