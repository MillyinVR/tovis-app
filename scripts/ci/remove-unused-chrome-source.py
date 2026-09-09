"""Remove only unused Google Chrome APT entries from an ephemeral CI runner."""

import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


def is_chrome_uri(token):
    parsed = urlsplit(token)
    return parsed.hostname == "dl.google.com" and parsed.path.rstrip("/") in (
        "/linux/chrome/deb", "/linux/chrome-stable/deb"
    )


def clean_source(text, suffix):
    if suffix == ".list":
        return "".join(
            line for line in text.splitlines(keepends=True)
            if not (
                re.match(r"^\s*deb(?:-src)?\s", line)
                and any(is_chrome_uri(token) for token in line.split())
            )
        )
    if suffix != ".sources":
        return text
    # deb822 supports multiple repositories in one file and multiple URIs in
    # one stanza. Retain unrelated stanzas AND unrelated URIs in a mixed stanza.
    blocks = re.split(r"\n\s*\n", text)
    kept = []
    changed = False
    for block in blocks:
        field = re.search(r"(?im)^URIs:[^\n]*(?:\n[ \t]+[^\n]*)*", block)
        if field:
            uris = field.group().split(":", 1)[1].split()
            remaining = [uri for uri in uris if not is_chrome_uri(uri)]
            if len(remaining) != len(uris):
                changed = True
                if not remaining:
                    continue
                block = block[:field.start()] + "URIs: " + " ".join(remaining) + block[field.end():]
        kept.append(block)
    return "\n\n".join(kept) if changed else text


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    for source in sorted(directory.iterdir()):
        if not source.is_file() or source.suffix not in (".list", ".sources"):
            continue
        original = source.read_text()
        cleaned = clean_source(original, source.suffix)
        if cleaned != original:
            source.write_text(cleaned)
            print(f"Removed unused Chrome APT entries from {source.name}")
