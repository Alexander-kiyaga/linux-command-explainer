"""Exercise the actual Ansible release gate against disposable local layouts."""

import getpass
import json
import os
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path

import pytest
from jinja2 import Environment

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "infrastructure/aws/tasks/validate_staged_release.yml"
UNIT_TEMPLATE = ROOT / "infrastructure/aws/templates/linux-explainer.service.j2"
COMMIT = "a" * 40


def staged_release(tmp_path):
    root = tmp_path / "linuxlab"
    stage = root / "releases" / f".staging-{COMMIT}"
    (stage / "app/static/js/bash").mkdir(parents=True)
    (stage / "wsgi.py").write_text(
        "class App:\n"
        "    def test_client(self): return self\n"
        "    def get(self, path): return type('Response', (), {'status_code': 200})()\n"
        "    def __call__(self, environ, start_response):\n"
        "        start_response('200 OK', [('Content-Type', 'text/plain')])\n"
        "        return [b'ok']\n"
        "app = App()\n",
        encoding="utf-8",
    )
    for name in ("requirements.txt", "app/__init__.py", "app/static/js/bash/worker.js"):
        target = stage / name
        target.write_text("fixture\n", encoding="utf-8")
    (stage / "release.json").write_text(json.dumps({"application": "LinuxLab AI", "commit": COMMIT}))
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(stage / "venv")], check=True)
    python = stage / "venv/bin/python"
    if not python.is_symlink():
        python.unlink()
        python.symlink_to("python3")
    return root, stage, python


def run_validator(tmp_path, stage):
    if shutil.which("ansible-playbook") is None:
        pytest.skip("Ansible is unavailable for the deployment integration test")
    playbook = tmp_path / "validate.yml"
    playbook.write_text(
        "---\n- hosts: localhost\n  connection: local\n  gather_facts: false\n"
        "  vars:\n"
        f"    stage_dir: {json.dumps(str(stage))}\n"
        f"    app_user: {json.dumps(getpass.getuser())}\n"
        "  tasks:\n"
        f"    - ansible.builtin.import_tasks: {json.dumps(str(VALIDATOR))}\n",
        encoding="utf-8",
    )
    temp = tmp_path / "ansible-temp"
    temp.mkdir(exist_ok=True)
    env = os.environ.copy()
    env.update(ANSIBLE_LOCAL_TEMP=str(temp), ANSIBLE_REMOTE_TEMP=str(temp),
               ANSIBLE_NOCOLOR="1", PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(["ansible-playbook", "-i", "localhost,", str(playbook)],
                          cwd=tmp_path, env=env, capture_output=True, text=True)


def test_valid_symlink_and_finalized_release_gunicorn(tmp_path):
    root, stage, python = staged_release(tmp_path)
    old_stage = root / "releases" / (".staging-" + "b" * 40)
    old_inactive = root / "releases" / ("c" * 40)
    old_stage.mkdir()
    old_inactive.mkdir()
    assert python.is_symlink()
    result = run_validator(tmp_path, stage)
    assert result.returncode == 0, result.stdout + result.stderr

    final = root / "releases" / COMMIT
    stage.rename(final)
    relocated_python = final / "venv/bin/python"
    assert subprocess.run([str(relocated_python), "--version"], capture_output=True).returncode == 0
    env = os.environ.copy()
    env.update(PYTHONPATH=sysconfig.get_path("purelib"), PYTHONDONTWRITEBYTECODE="1")
    check = subprocess.run([str(relocated_python), "-m", "gunicorn", "--check-config", "wsgi:app"],
                           cwd=final, env=env, capture_output=True, text=True)
    assert check.returncode == 0, check.stdout + check.stderr

    from scripts.switch_release import switch
    assert switch(root, "activate", COMMIT)["current"] == COMMIT
    assert os.readlink(root / "current") == f"releases/{COMMIT}"
    assert old_stage.is_dir() and old_inactive.is_dir()
    unit = Environment(autoescape=False).from_string(UNIT_TEMPLATE.read_text()).render(
        release_root=str(root), app_user=getpass.getuser()
    )
    assert f"WorkingDirectory={root}/current" in unit
    assert f"ExecStart={root}/current/venv/bin/python -m gunicorn " in unit


def test_real_application_layout_passes_staged_and_finalized_checks(tmp_path):
    root = tmp_path / "linuxlab"
    stage = root / "releases" / f".staging-{COMMIT}"
    stage.mkdir(parents=True)
    shutil.copytree(ROOT / "app", stage / "app", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(ROOT / "wsgi.py", stage / "wsgi.py")
    shutil.copy2(ROOT / "requirements.txt", stage / "requirements.txt")
    (stage / "release.json").write_text(json.dumps({"application": "LinuxLab AI", "commit": COMMIT}))
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(stage / "venv")], check=True)
    # Use already installed development dependencies without fetching packages.
    packages = stage / "venv/lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    packages.rmdir()
    packages.symlink_to(sysconfig.get_path("purelib"), target_is_directory=True)

    result = run_validator(tmp_path, stage)
    assert result.returncode == 0, result.stdout + result.stderr
    final = root / "releases" / COMMIT
    stage.rename(final)
    check = subprocess.run([str(final / "venv/bin/python"), "-m", "gunicorn", "--check-config", "wsgi:app"],
                           cwd=final, capture_output=True, text=True)
    assert check.returncode == 0, check.stdout + check.stderr


@pytest.mark.parametrize("defect,failed_task", [
    ("missing_python", "Require a real executable Python target"),
    ("broken_symlink", "Require a real executable Python target"),
    ("non_executable", "Require a real executable Python target"),
    ("directory_target", "Require a real executable Python target"),
    ("missing_wsgi", "Require regular staged application files"),
    ("missing_worker", "Require regular staged application files"),
    ("static_dir_symlink", "Require staged directories for Python and static assets"),
])
def test_invalid_staged_layout_fails_before_activation(tmp_path, defect, failed_task):
    _root, stage, python = staged_release(tmp_path)
    if defect == "missing_python":
        python.unlink()
    elif defect == "broken_symlink":
        python.unlink()
        python.symlink_to("missing-python")
    elif defect == "non_executable":
        python.unlink()
        target = stage / "venv/bin/non-executable"
        target.write_text("not executable\n")
        target.chmod(0o644)
        python.symlink_to(target.name)
    elif defect == "directory_target":
        python.unlink()
        target = stage / "venv/bin/not-a-file"
        target.mkdir()
        python.symlink_to(target.name)
    elif defect == "missing_wsgi":
        (stage / "wsgi.py").unlink()
    elif defect == "missing_worker":
        (stage / "app/static/js/bash/worker.js").unlink()
    else:
        directory = stage / "app/static/js/bash"
        directory.rename(stage / "app/static/js/bash-real")
        directory.symlink_to("bash-real", target_is_directory=True)
    result = run_validator(tmp_path, stage)
    assert result.returncode != 0
    assert failed_task in result.stdout + result.stderr
    assert not (stage.parent / COMMIT).exists()
