#!/usr/bin/env python3
"""Build and verify a deterministic, tracked-source-only LinuxLab release."""

import argparse
import gzip
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path


RELEASE_FILES = {"wsgi.py", "requirements.txt"}
APP_SUFFIXES = {".py", ".html", ".css", ".js", ".json", ".svg", ".png", ".webp", ".ico", ".woff2"}
COMMIT_RE = re.compile(r"[0-9a-f]{40,64}\Z")
REQUIRED = {"wsgi.py", "requirements.txt", "app/__init__.py", "app/static/js/bash/worker.js",
            "app/static/js/simulation/engine.js", "app/templates/bash.html"}
MAX_RELEASE_BYTES = 10 * 1024 * 1024
SENSITIVE_NAME = re.compile(r"(?:^|[-_.])(secret|credential|private[_-]?key|api[_-]?key)(?:[-_.]|$)", re.I)
SENSITIVE_CONTENT = re.compile(rb"AIza[0-9A-Za-z_-]{35}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE)


def allowed(name):
    parts = name.split("/")
    if name.startswith("/") or "\\" in name or any(part in {"", ".", ".."} for part in parts):
        return False
    path = Path(name)
    return (name in RELEASE_FILES or (len(parts) >= 2 and parts[0] == "app"
            and path.suffix in APP_SUFFIXES and not any(part.startswith(".") for part in parts)))


def git_files(repo, commit):
    entries = []
    for record in git(repo, "ls-tree", "-r", "-z", commit).split(b"\0"):
        if not record:
            continue
        metadata, raw_name = record.split(b"\t", 1)
        mode, kind, _oid = metadata.decode("ascii").split()
        name = raw_name.decode("utf-8")
        if name.startswith("app/") and SENSITIVE_NAME.search(Path(name).name):
            raise ValueError(f"Refusing sensitive-looking tracked source path: {name}")
        if allowed(name):
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise ValueError(f"Refusing non-regular release entry: {name}")
            entries.append((name, mode))
    names = {name for name, _ in entries}
    if not REQUIRED <= names:
        raise ValueError(f"Commit lacks required LinuxLab files: {sorted(REQUIRED - names)}")
    return sorted(entries)


def build(repo, commit_ref, output_dir, allow_dirty=False):
    repo = Path(repo).resolve()
    if Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve() != repo:
        raise ValueError("--repo must be the Git repository root")
    if git(repo, "status", "--porcelain=v1", "--untracked-files=all").strip() and not allow_dirty:
        raise ValueError("Source tree is dirty; commit changes or explicitly pass --allow-dirty to package committed content only")
    commit = git(repo, "rev-parse", "--verify", f"{commit_ref}^{{commit}}").decode().strip()
    tree = git(repo, "rev-parse", f"{commit}^{{tree}}").decode().strip()
    timestamp = int(git(repo, "show", "-s", "--format=%ct", commit).decode().strip())
    files = git_files(repo, commit)
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"linuxlab-{commit[:12]}.tar.gz"
    temporary = output_dir / f".{archive.name}.tmp"
    metadata = {"application": "LinuxLab AI", "commit": commit, "tree": tree, "format": 1}
    try:
        with temporary.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for name, mode in files:
                    data = git(repo, "show", f"{commit}:{name}")
                    if SENSITIVE_CONTENT.search(data):
                        raise ValueError(f"Refusing known credential pattern in {name}")
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o755 if mode == "100755" else 0o644
                    info.mtime = timestamp
                    info.uid = info.gid = 0
                    info.uname = info.gname = "root"
                    tar.addfile(info, io.BytesIO(data))
                data = (json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n").encode()
                info = tarfile.TarInfo("release.json")
                info.size, info.mode, info.mtime = len(data), 0o644, timestamp
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                tar.addfile(info, io.BytesIO(data))
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output_dir / f"{archive.name}.sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    return archive, digest, commit


def verify(archive, expected_commit, expected_sha256, repo=None):
    archive = Path(archive)
    if not COMMIT_RE.fullmatch(expected_commit) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("Expected commit and SHA-256 must be full lowercase hex values")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("Release archive checksum does not match")
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        names = [member.name for member in members]
        if len(set(names)) != len(names) or not set(names) >= REQUIRED | {"release.json"}:
            raise ValueError("Release manifest is incomplete or has duplicate entries")
        if any(not member.isfile() or not (allowed(member.name) or member.name == "release.json")
               or member.size > MAX_RELEASE_BYTES for member in members):
            raise ValueError("Release contains an unsafe entry")
        if sum(member.size for member in members) > MAX_RELEASE_BYTES:
            raise ValueError("Release exceeds size limit")
        metadata = json.load(tar.extractfile("release.json"))
        if not isinstance(metadata, dict) or metadata.get("application") != "LinuxLab AI" \
                or metadata.get("format") != 1 or metadata.get("commit") != expected_commit \
                or not isinstance(metadata.get("tree"), str) or not COMMIT_RE.fullmatch(metadata["tree"]):
            raise ValueError("Release identity does not match")
        if repo is not None:
            repo = Path(repo).resolve()
            expected_tree = git(repo, "rev-parse", f"{expected_commit}^{{tree}}").decode().strip()
            expected_files = {name for name, _ in git_files(repo, expected_commit)}
            if metadata["tree"] != expected_tree or set(names) != expected_files | {"release.json"}:
                raise ValueError("Release contents do not match the claimed Git tree")
            for name in expected_files:
                if tar.extractfile(name).read() != git(repo, "show", f"{expected_commit}:{name}"):
                    raise ValueError(f"Release file differs from Git: {name}")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    builder = sub.add_parser("build")
    builder.add_argument("--repo", required=True)
    builder.add_argument("--commit", required=True)
    builder.add_argument("--output-dir", required=True)
    builder.add_argument("--allow-dirty", action="store_true", help="Package committed content only despite local edits")
    checker = sub.add_parser("verify")
    checker.add_argument("--artifact", required=True)
    checker.add_argument("--commit", required=True)
    checker.add_argument("--sha256", required=True)
    checker.add_argument("--repo", help="Compare every archived file with this Git repository and commit")
    args = parser.parse_args()
    try:
        if args.action == "build":
            archive, digest, commit = build(args.repo, args.commit, args.output_dir, args.allow_dirty)
            print(json.dumps({"artifact": str(archive), "commit": commit, "sha256": digest}, sort_keys=True))
        else:
            print(json.dumps(verify(args.artifact, args.commit, args.sha256, args.repo), sort_keys=True))
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as exc:
        parser.exit(1, f"release: {exc}\n")


if __name__ == "__main__":
    main()
