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


def test_bash_interpreter_core_has_no_host_network_dom_or_dynamic_execution():
    bash_dir = SIMULATION.parent / "bash"
    core_names = ("errors.js", "limits.js", "lexer.js", "parser.js", "expand.js", "glob.js", "interpreter.js", "worker.js")
    for name in core_names:
        source = (bash_dir / name).read_text(encoding="utf-8")
        for pattern in FORBIDDEN + (r"\bWebAssembly\b", r"\bnew\s+Function\b", r"\bchild_process\b", r"\bnode:fs\b"):
            assert not re.search(pattern, source), f"Forbidden capability {pattern} in {name}"
        for imported in re.findall(r'from\s+["\']([^"\']+)["\']', source):
            assert imported.startswith("."), f"Nonlocal import {imported} in {name}"
    interpreter = (bash_dir / "interpreter.js").read_text(encoding="utf-8")
    assert 'from "../simulation/engine.js"' in interpreter
    assert "executeParsedCommand" in interpreter
    assert 'from "../simulation/parser.js"' not in interpreter


def test_bash_run_path_has_no_flask_execution_request():
    controller = (SIMULATION.parent / "bash.js").read_text(encoding="utf-8")
    assert controller.count("fetch(") == 1
    assert 'fetch("/api/bash/explain"' in controller
    assert "/api/bash/run" not in controller
    worker = (SIMULATION.parent / "bash" / "worker.js").read_text(encoding="utf-8")
    assert "fetch(" not in worker
    service = (SIMULATION.parent.parent.parent / "bash_explainer.py").read_text(encoding="utf-8")
    for forbidden in ("subprocess", "os.system", "/bin/bash", "Popen(", "exec(", "eval("):
        assert forbidden not in service
