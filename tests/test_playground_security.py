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


def test_mission_core_modules_have_no_host_browser_or_network_capabilities():
    mission_dir = SIMULATION.parent / "missions"
    files = list(mission_dir.rglob("*.js"))
    assert files
    for path in files:
        source = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN:
            assert not re.search(pattern, source), f"Forbidden capability {pattern} in {path}"
        for imported in re.findall(r'from\s+["\']([^"\']+)["\']', source):
            assert imported.startswith("."), f"Nonlocal import {imported} in {path}"


def test_terminal_controllers_do_not_transmit_simulated_commands():
    static_js = SIMULATION.parent
    for name in ("terminal-ui.js", "playground.js", "missions.js"):
        source = (static_js / name).read_text(encoding="utf-8")
        for pattern in (r"\bfetch\s*\(", r"\bXMLHttpRequest\b", r"\bWebSocket\b"):
            assert not re.search(pattern, source), f"Network API {pattern} in {name}"


def test_compatibility_modules_cannot_dispatch_commands():
    for name in ("compatibility.js", "syntax.js", "registry.js"):
        source = (SIMULATION / name).read_text(encoding="utf-8")
        assert "executeLine" not in source
        assert "executeParsedCommand" not in source
        assert "./engine.js" not in source
        assert "commands/files.js" not in source
        assert "commands/basic.js" not in source
        assert "commands/text.js" not in source
