#!/usr/bin/env python3
"""Fetch Star Wars 5e tech powers and export them as JSON.

Usage:
    python scripts/scrape_sw5e_tech_powers.py

This script will download Star Wars 5e tech powers and write them to
`static/data/tech_powers.json` so the frontend can show full rules text.

It first attempts to use the public SW5e JSON API. If that fails, it
falls back to parsing the rendered HTML page (which requires the site to
serve static content). Relative URLs are preserved so the UI can link
back to the original page.

Notes:
- Requires `requests` and `beautifulsoup4` (install via pip).
- Do not run this repeatedly; cache the file locally and update it only
  when SW5e publishes changes.
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

SOURCE_URL = "https://sw5e.com/rules/phb/casting/techPowers"
API_URL = "https://sw5e.com/api/powers/tech"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "static" / "data" / "tech_powers.json"
REQUEST_TIMEOUT = 30
HEADERS = {
    "User-Agent": "GorgoxInteractiveScraper/1.0 (+https://github.com/)"
}

FIELD_LABELS = {
    "casting time": "casting_time",
    "casting period": "casting_time",
    "range": "range",
    "duration": "duration",
    "components": "components",
    "target": "target",
    "primary ability": "primary_ability",
    "saving throw": "saving_throw",
}


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().replace("\xa0", " ")


def parse_detail_lines(lines, details):
    remaining = []
    for line in lines:
        normalized = line.lower()
        matched = False
        for label, key in FIELD_LABELS.items():
            if normalized.startswith(label + ":"):
                value = line.split(":", 1)[1].strip()
                details[key] = value
                matched = True
                break
        if not matched:
            remaining.append(line)
    return remaining


def extract_power_blocks(soup: BeautifulSoup):
    article = soup.find("article") or soup.find("div", class_="content")
    if not article:
        return

    for header in article.find_all(["h2", "h3"]):
        name = clean_text(header.get_text())
        if not name:
            continue

        parts = []
        for sibling in header.next_siblings:
            if isinstance(sibling, NavigableString):
                text = clean_text(str(sibling))
                if text:
                    parts.append(text)
                continue

            if isinstance(sibling, Tag) and sibling.name in ("h2", "h3"):
                break

            if isinstance(sibling, Tag):
                parts.append(clean_text(sibling.get_text(" ")))

        block = [p for p in parts if p]
        if block:
            yield header, name, block


def build_power_record(header: Tag, name: str, block_lines: list[str]) -> dict:
    record = {
        "name": name,
        "source_url": SOURCE_URL,
        "description": "",
    }

    anchor = header.find("a", attrs={"href": True})
    if anchor and anchor["href"].startswith("#"):
        record["source_url"] = SOURCE_URL + anchor["href"]

    working_lines = parse_detail_lines(block_lines, record)
    match = re.search(r"level\s+(\d+)", name, re.IGNORECASE)
    if match:
        record["level"] = int(match.group(1))

    record["description"] = "\n\n".join(working_lines).strip()
    return record


def fetch_from_api():
    response = requests.get(API_URL, timeout=REQUEST_TIMEOUT, headers=HEADERS)
    response.raise_for_status()
    data = response.json()

    if isinstance(data, dict):
        entries = data.get("results") or data.get("data") or []
    elif isinstance(data, list):
        entries = data
    else:
        entries = []

    powers = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not name:
            continue
        power = {
            "name": name,
            "level": entry.get("level"),
            "casting_time": entry.get("casting_period") or entry.get("casting_time"),
            "range": entry.get("range"),
            "duration": entry.get("duration"),
            "components": entry.get("components"),
            "description": entry.get("description") or entry.get("effect") or "",
            "power_type": entry.get("classification") or entry.get("type") or "tech",
            "source_url": entry.get("url") or SOURCE_URL,
        }
        if entry.get("concentration"):
            power["concentration"] = entry["concentration"]
        if entry.get("saving_throw"):
            power["saving_throw"] = entry["saving_throw"]
        powers.append(power)
    return powers


def scrape_html():
    response = requests.get(SOURCE_URL, timeout=REQUEST_TIMEOUT, headers=HEADERS)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    powers = []
    for header, name, block in extract_power_blocks(soup):
        record = build_power_record(header, name, block)
        powers.append(record)
    return powers


def scrape() -> list[dict]:
    try:
        powers = fetch_from_api()
        if powers:
            print(f"Fetched {len(powers)} powers from API")
            return powers
        print("API returned no powers; falling back to HTML scrape")
    except Exception as api_err:
        print(f"API fetch failed: {api_err}. Falling back to HTML scrape…")

    powers = scrape_html()
    print(f"Scraped {len(powers)} powers from HTML")
    return powers


def main() -> None:
    powers = scrape()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(powers, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(powers)} tech powers to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
