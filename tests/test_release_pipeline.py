"""Offline release, rollback, and generated Nginx policy checks."""

import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
from pathlib import Path

import pytest
from jinja2 import Environment

from scripts.release import allowed, build, verify
from scripts.switch_release import switch
from scripts.check_terraform_state import check_state


def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def tiny_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    run("git", "init", "-q", cwd=repo)
    run("git", "config", "user.email", "test@example.invalid", cwd=repo)
    run("git", "config", "user.name", "Release Test", cwd=repo)
    for name in ("wsgi.py", "requirements.txt", "app/__init__.py", "app/static/js/bash/worker.js",
                 "app/static/js/simulation/engine.js", "app/templates/bash.html", "app/static/js/playground.js"):
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"committed {name}\n", encoding="utf-8")
    for name in (".env", "infrastructure/aws/terraform.tfstate", "app/__pycache__/bad.pyc"):
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("SENTINEL_SECRET", encoding="utf-8")
    run("git", "add", ".", cwd=repo)
    run("git", "commit", "-qm", "test release", cwd=repo)
    return repo


def test_release_is_deterministic_and_excludes_secrets(tiny_repo, tmp_path):
    assert not allowed("app/../escape.py")
    assert not allowed("app//escape.py")
    assert not allowed("/app/escape.py")
    first, digest, commit = build(tiny_repo, "HEAD", tmp_path / "out")
    assert verify(first, commit, digest, tiny_repo)["commit"] == commit
    with tarfile.open(first) as tar:
        names = set(tar.getnames())
        assert {"app/static/js/bash/worker.js", "app/static/js/playground.js", "release.json"} <= names
        assert ".env" not in names
        assert not any("terraform" in name or "__pycache__" in name or name.startswith(".git") for name in names)
    bytes_before = first.read_bytes()
    first_again, digest_again, _ = build(tiny_repo, commit, tmp_path / "out")
    assert first_again.read_bytes() == bytes_before and digest_again == digest
    assert (tmp_path / "out" / f"{first.name}.sha256").read_text().startswith(digest)
    first.write_bytes(bytes_before + b"tamper")
    with pytest.raises(ValueError, match="checksum"):
        verify(first, commit, digest)


def test_dirty_tree_is_refused_unless_explicitly_packaging_committed_content(tiny_repo, tmp_path):
    (tiny_repo / "app" / "__init__.py").write_text("UNCOMMITTED_SECRET", encoding="utf-8")
    with pytest.raises(ValueError, match="dirty"):
        build(tiny_repo, "HEAD", tmp_path / "out")
    archive, digest, commit = build(tiny_repo, "HEAD", tmp_path / "out", allow_dirty=True)
    verify(archive, commit, digest, tiny_repo)
    with tarfile.open(archive) as tar:
        assert b"UNCOMMITTED_SECRET" not in tar.extractfile("app/__init__.py").read()


def test_repository_comparison_rejects_forged_release_contents(tiny_repo, tmp_path):
    archive, _digest, commit = build(tiny_repo, "HEAD", tmp_path / "out")
    forged = tmp_path / "forged.tar.gz"
    with tarfile.open(archive) as original, tarfile.open(forged, "w:gz") as altered:
        for member in original.getmembers():
            data = original.extractfile(member).read()
            if member.name == "app/__init__.py":
                data = b"forged code\n"
                member.size = len(data)
            altered.addfile(member, io.BytesIO(data))
    forged_digest = hashlib.sha256(forged.read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="differs from Git"):
        verify(forged, commit, forged_digest, tiny_repo)


def test_atomic_switch_and_rollback_use_verified_release_directories(tmp_path):
    root = tmp_path / "linuxlab"
    (root / "releases").mkdir(parents=True)
    old, new = "a" * 40, "b" * 40
    for commit in (old, new):
        release = root / "releases" / commit
        release.mkdir()
        (release / "release.json").write_text(json.dumps({"application": "LinuxLab AI", "commit": commit}))
    assert switch(root, "activate", old) == {"current": old, "previous": None}
    assert switch(root, "activate", new) == {"current": new, "previous": old}
    assert switch(root, "rollback") == {"current": old, "previous": new}
    with pytest.raises(ValueError, match="does not exist"):
        switch(root, "activate", "c" * 40)
    assert os.readlink(root / "current") == f"releases/{old}"


def test_first_install_requires_explicit_empty_rollback(tmp_path):
    root = tmp_path / "linuxlab"
    release = root / "releases" / ("a" * 40)
    release.mkdir(parents=True)
    (release / "release.json").write_text(json.dumps({"application": "LinuxLab AI", "commit": "a" * 40}))
    switch(root, "activate", "a" * 40)
    with pytest.raises(ValueError, match="No previous release"):
        switch(root, "rollback")
    assert (root / "current").is_symlink()
    assert switch(root, "rollback", allow_empty=True) == {"current": None, "previous": None}


def test_http_nginx_preserves_ai_limits_static_worker_and_security_headers():
    template = (Path(__file__).resolve().parent.parent / "infrastructure/aws/templates/nginx.conf.j2").read_text()
    env = Environment(autoescape=False)
    result = env.from_string(template).render(
        release_root="/opt/linuxlab", ai_requests_per_minute=6, ai_burst=2, ai_max_inflight=1,
    )
    assert "listen 80 default_server;" in result
    assert "server_name _;" in result
    assert "limit_req_zone $binary_remote_addr zone=ai_per_ip:10m rate=6r/m;" in result
    assert "limit_conn ai_concurrent 1;" in result
    assert result.count("limit_req zone=ai_per_ip burst=2 nodelay;") == 1
    assert "location ^~ /static/" in result
    assert "alias /opt/linuxlab/current/app/static/;" in result
    assert 'Cache-Control "public, max-age=300, must-revalidate"' in result
    assert "worker-src 'self'" in result
    assert "add_header X-Content-Type-Options nosniff always;" in result
    assert "add_header Referrer-Policy no-referrer always;" in result
    assert "add_header X-Frame-Options DENY always;" in result
    assert "Strict-Transport-Security" not in result
    assert "443" not in result and "certbot" not in result and "acme-challenge" not in result


def test_assignment_terraform_uses_ec2_public_ip_and_only_ssh_http_ingress():
    terraform = (Path(__file__).resolve().parent.parent / "infrastructure/aws/main.tf").read_text()
    assert re.search(r"^\s*ami\s*=\s*var\.ami_id$", terraform, re.M)
    assert "data.aws_ssm_parameter.amazon_linux.value" not in terraform
    assert "associate_public_ip_address = true" not in terraform
    assert "prevent_destroy = true" in terraform
    assert "value       = aws_instance.web.public_ip" in terraform
    assert "aws_eip" not in terraform
    assert "from_port   = 80" in terraform and "from_port   = 22" in terraform
    assert "from_port   = 443" not in terraform


def test_existing_state_identity_guard_rejects_missing_or_wrong_resources(tmp_path):
    state = tmp_path / "terraform.tfstate"
    document = {
        "version": 4, "lineage": "existing-lineage", "serial": 3,
        "resources": [
            {"mode": "managed", "type": "aws_instance", "name": "web",
             "instances": [{"attributes": {"id": "i-existing", "root_block_device": [{"volume_id": "vol-existing"}]}}]},
            {"mode": "managed", "type": "aws_security_group", "name": "web",
             "instances": [{"attributes": {"id": "sg-existing"}}]},
        ],
    }
    state.write_text(json.dumps(document))
    assert check_state(state, "i-existing", "sg-existing", "vol-existing")["serial"] == 3
    with pytest.raises(ValueError, match="expected EC2"):
        check_state(state, "i-other", "sg-existing", "vol-existing")
    with pytest.raises(ValueError, match="expected security group"):
        check_state(state, "i-existing", "sg-other", "vol-existing")
    with pytest.raises(ValueError, match="expected EC2 root volume"):
        check_state(state, "i-existing", "sg-existing", "vol-other")
    document["resources"] = []
    state.write_text(json.dumps(document))
    with pytest.raises(ValueError, match="exactly one"):
        check_state(state, "i-existing", "sg-existing", "vol-existing")


def test_deployment_prepares_before_active_changes_and_recovers_legacy():
    playbook = (Path(__file__).resolve().parent.parent / "infrastructure/aws/deploy.yml").read_text()
    preparation, activation = playbook.split("    - name: Activate, verify, or roll back the release", 1)
    assert "dest: /etc/systemd/system/linux-explainer.service" not in preparation
    assert "dest: /etc/nginx/nginx.conf" not in preparation
    assert "state: reloaded" not in preparation
    ordered_preparation = [
        "Verify archive paths and embedded commit before transfer",
        "Preserve original service and Nginx configuration before preparation",
        "Extract only into the fresh staging directory",
        "Install pinned dependencies into this release",
        "Install private runtime environment outside releases",
        "Probe staged Flask application without starting a public service",
        "Prepare and validate Nginx without changing its active configuration",
        "Finalize clean release directory",
    ]
    offsets = [preparation.index(name) for name in ordered_preparation]
    assert offsets == sorted(offsets)
    assert "local_secrets.stat.mode | default('') in ['0400', '0600']" in preparation
    assert activation.index("Atomically switch current") < activation.index("Activate prepared Gunicorn")
    assert activation.index("Probe new Gunicorn directly") < activation.index("Activate validated Nginx")
    assert activation.index("Activate validated Nginx") < activation.index("Probe health, all learning pages")
    assert "Restore the original legacy Gunicorn service configuration" in activation
    assert "Restore the original legacy Nginx configuration" in activation
    assert "Restore the previous LinuxLab release" in activation
    assert "Check recovered application through Nginx" in activation
