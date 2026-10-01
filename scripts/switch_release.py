#!/usr/bin/env python3
"""Atomically switch LinuxLab's current/previous release symlinks."""

import argparse
import json
import os
import re
import uuid
from pathlib import Path


SHA = re.compile(r"[0-9a-f]{40,64}\Z")


def target_commit(root, link_name):
    link = root / link_name
    if not link.is_symlink():
        if link.exists():
            raise ValueError(f"{link_name} exists but is not a release symlink")
        return None
    target = os.readlink(link)
    prefix = "releases/"
    commit = target[len(prefix):] if target.startswith(prefix) else ""
    if not SHA.fullmatch(commit):
        raise ValueError(f"{link_name} points outside versioned releases")
    return commit


def validate_release(root, commit):
    if not SHA.fullmatch(commit):
        raise ValueError("Release identity must be a full Git commit hash")
    release = root / "releases" / commit
    if not release.is_dir() or release.is_symlink():
        raise ValueError("Requested release directory does not exist")
    identity = json.loads((release / "release.json").read_text(encoding="utf-8"))
    if identity.get("application") != "LinuxLab AI" or identity.get("commit") != commit:
        raise ValueError("Release directory identity does not match")


def atomic_link(root, name, commit):
    link = root / name
    target_commit(root, name)  # Refuse to replace an unrelated file or directory.
    temporary = root / f".{name}.{uuid.uuid4().hex}.tmp"
    try:
        os.symlink(f"releases/{commit}", temporary)
        os.replace(temporary, link)
    finally:
        temporary.unlink(missing_ok=True)


def switch(root, action, commit=None, allow_empty=False):
    root = Path(root).resolve()
    if not root.is_dir() or not (root / "releases").is_dir():
        raise ValueError("LinuxLab release root is missing")
    current = target_commit(root, "current")
    previous = target_commit(root, "previous")
    if action == "activate":
        validate_release(root, commit)
        if current == commit:
            raise ValueError("Release is already active")
        if current:
            validate_release(root, current)
            atomic_link(root, "previous", current)
        atomic_link(root, "current", commit)
    elif action == "rollback":
        if previous:
            validate_release(root, previous)
            atomic_link(root, "current", previous)
            if current:
                atomic_link(root, "previous", current)
        else:
            if not allow_empty:
                raise ValueError("No previous release exists; refusing to clear current")
            # Explicit first-install failure recovery: do not leave a failed release active.
            (root / "current").unlink(missing_ok=True)
    else:
        raise ValueError("Unknown switch action")
    return {"current": target_commit(root, "current"), "previous": target_commit(root, "previous")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("activate", "rollback"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--commit", help="Full Git commit for activate")
    parser.add_argument("--allow-empty", action="store_true", help="Allow first-install failure to clear current")
    args = parser.parse_args()
    try:
        print(json.dumps(switch(args.root, args.action, args.commit, args.allow_empty), sort_keys=True))
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.exit(1, f"switch_release: {exc}\n")


if __name__ == "__main__":
    main()
