import json
from pathlib import Path
import pytest

DATA_FILE = Path(__file__).resolve().parent.parent / "app" / "data" / "commands.json"


def test_commands_file_exists():
    """Verify that the commands.json dictionary file exists."""
    assert DATA_FILE.exists(), f"Missing commands dictionary at {DATA_FILE}"


def test_commands_dictionary_structure():
    """Verify that commands.json contains at least 30 valid command definitions."""
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert isinstance(data, list), "commands.json must be a JSON list"
    assert len(data) >= 30, f"Expected at least 30 commands, found {len(data)}"

    required_keys = {"id", "name", "category", "description", "example", "impact", "impact_reason"}
    valid_impacts = {"read", "modify", "delete", "depends", "unknown"}
    seen_ids = set()

    for item in data:
        # Check required fields
        for key in required_keys:
            assert key in item, f"Command {item.get('name', '?')} missing required key '{key}'"
            assert isinstance(item[key], str), f"Field '{key}' in command {item['name']} must be a string"
            assert len(item[key].strip()) > 0, f"Field '{key}' in command {item['name']} cannot be empty"

        # Unique IDs
        assert item["id"] not in seen_ids, f"Duplicate command id found: {item['id']}"
        seen_ids.add(item["id"])

        # Validate impact label corresponds to allowed categories
        assert item["impact"].lower() in valid_impacts, (
            f"Invalid impact '{item['impact']}' for command {item['name']}. "
            f"Must be one of: {valid_impacts}"
        )


def test_commands_have_diverse_categories():
    """Verify grouping across multiple categories."""
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    categories = {item["category"] for item in data}
    assert len(categories) >= 3, f"Expected at least 3 distinct categories, found {len(categories)}"
    assert "File & Directory Management" in categories
    assert "Text Processing & Search" in categories
    assert "System & Process Management" in categories
