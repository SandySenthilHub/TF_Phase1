import sys
import os
import re
import json
from typing import Dict


def extract_fields(text: str) -> Dict[str, str]:
    fields = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    pattern_colon = re.compile(r'^(.{2,60}?)\s*[:：]\s*(.+)$')
    pattern_inline = re.compile(r'^([A-Z\s]{3,60})\s+([^\s]{1,80})$')

    for line in lines:
        match = pattern_colon.match(line)
        if match:
            key, value = match.groups()
            fields[key.strip()] = value.strip()
            continue

        match_inline = pattern_inline.match(line)
        if match_inline:
            key, value = match_inline.groups()
            fields[key.strip()] = value.strip()
            continue

    return fields


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python extract_fields.py <ocr_txt_path>"}))
        sys.exit(1)

    txt_path = sys.argv[1]
    if not os.path.exists(txt_path):
        print(json.dumps({"error": f" File not found: {txt_path}"}))
        sys.exit(1)

    with open(txt_path, "r", encoding="utf-8") as f:
        text = f.read()

    result = extract_fields(text)
    print(json.dumps(result, indent=2, ensure_ascii=False))
