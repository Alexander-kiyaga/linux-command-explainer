import os
import math
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root if present
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    """Reject unsafe operational settings instead of silently using a fallback."""
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be between {minimum} and {maximum}") from exc
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


class Config:
    """Application configuration loaded from environment variables."""

    # Raw API key with placeholder detection
    _raw_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    PLACEHOLDER_KEYS = {"", "your_gemini_api_key_here", "YOUR_GEMINI_API_KEY"}
    GEMINI_API_KEY = _raw_api_key if _raw_api_key not in PLACEHOLDER_KEYS else None

    # Model configuration - default to official balanced model gemini-2.5-flash
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

    # Timeouts: user specifies seconds, SDK requires milliseconds
    API_TIMEOUT_SECONDS = bounded_float("API_TIMEOUT_SECONDS", 15.0, 1.0, 60.0)
    API_TIMEOUT_MS = int(API_TIMEOUT_SECONDS * 1000)

    # Security input constraints
    MAX_INPUT_LENGTH = bounded_int("MAX_INPUT_LENGTH", 500, 1, 1000)
    MAX_REQUEST_BYTES = 16 * 1024

    # Configurable maximum output token limit (reduces bloat, does not guarantee complete response)
    MAX_OUTPUT_TOKENS = bounded_int("MAX_OUTPUT_TOKENS", 1500, 128, 8192)

    # Separate bounded output budget for multi-step educational plans.
    TASK_BUILDER_MAX_OUTPUT_TOKENS = bounded_int("TASK_BUILDER_MAX_OUTPUT_TOKENS", 3000, 256, 8192)

    # Separate bound for line-by-line Bash explanations.
    BASH_MAX_OUTPUT_TOKENS = bounded_int("BASH_MAX_OUTPUT_TOKENS", 4000, 256, 8192)

    # Server settings
    PORT = bounded_int("PORT", 5000, 1, 65535)

    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "False").lower() in ("true", "1", "t")

    @classmethod
    def is_api_key_configured(cls) -> bool:
        """Return True only if a real non-placeholder Gemini API key is configured."""
        return cls.GEMINI_API_KEY is not None and len(cls.GEMINI_API_KEY) > 0
