#!/usr/bin/env python3
"""Read-only identity check before planning against an existing EC2 state."""

import argparse
import json
from pathlib import Path


def managed_attributes(state, resource_type, name):
    matches = [resource for resource in state.get("resources", [])
               if resource.get("mode") == "managed"
               and resource.get("type") == resource_type
               and resource.get("name") == name
               and not resource.get("module")]
    if len(matches) != 1 or len(matches[0].get("instances", [])) != 1:
        raise ValueError(f"Expected exactly one root {resource_type}.{name} instance")
    return matches[0]["instances"][0].get("attributes", {})


def check_state(path, instance_id, security_group_id, root_volume_id):
    state = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(state, dict) or state.get("version") != 4 or not state.get("lineage"):
        raise ValueError("Expected an existing Terraform v4 state with a lineage")
    instance = managed_attributes(state, "aws_instance", "web")
    if instance.get("id") != instance_id:
        raise ValueError("State does not manage the expected EC2 instance")
    if managed_attributes(state, "aws_security_group", "web").get("id") != security_group_id:
        raise ValueError("State does not manage the expected security group")
    root = instance.get("root_block_device", [])
    if len(root) != 1 or root[0].get("volume_id") != root_volume_id:
        raise ValueError("State does not manage the expected EC2 root volume")
    return {"instance_id": instance_id, "security_group_id": security_group_id,
            "root_volume_id": root_volume_id,
            "lineage": state["lineage"], "serial": state.get("serial")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--security-group-id", required=True)
    parser.add_argument("--root-volume-id", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(check_state(args.state, args.instance_id, args.security_group_id,
                                     args.root_volume_id), sort_keys=True))
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        parser.exit(1, f"state check failed: {exc}\n")


if __name__ == "__main__":
    main()
