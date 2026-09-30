"""Guard the browser-only simulation boundary against accidental host or network APIs."""
import re
from pathlib import Path

SIMULATION = Path(__file__).resolve().parent.parent / "app" / "static" / "js" / "simulation"
FORBIDDEN = (
    r"\bfetch\s*\(", r"\bXMLHttpRequest\b", r"\bWebSocket\b", r"\bdocument\b",
    r"\bwindow\b", r"\blocalStorage\b", r"\bnavigator\b", r"\bprocess\b",
    r"\brequire\s*\(", r"\beval\s*\(", r"\bFunction\s*\(", r"\bimport\s*\(",
)


def test_simulation_modules_have_no_host_browser_or_network_capabilities():
    files = list(SIMULATION.rglob("*.js"))
    assert files
    for path in files:
        source = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN:
            assert not re.search(pattern, source), f"Forbidden capability {pattern} in {path}"
        for imported in re.findall(r'from\s+["\']([^"\']+)["\']', source):
            assert imported.startswith("."), f"Nonlocal import {imported} in {path}"
