#!/usr/bin/env python3
"""
Scrape the SW5e Tech Powers listing into JSON.

Requirements:
  pip install playwright
  playwright install chromium

Usage:
  python scrape_sw5e_tech_powers.py -o sw5e_tech_powers.json
  python scrape_sw5e_tech_powers.py --url https://sw5e.com/characters/techPowers -o out.json
"""

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
import argparse, json, time

DEFAULT_URL = "https://sw5e.com/characters/techPowers"

def normalize_header(h: str) -> str:
    return " ".join(h.lower().split())

def parse_table(page):
    """
    Returns (rows:list[dict], found_headers:list[str])
    """
    table = page.locator("table").first
    # Grab headers (fallbacks if site wording changes slightly)
    headers = []
    ths = table.locator("thead th")
    try:
        th_count = ths.count()
    except PlaywrightTimeout:
        th_count = 0

    for i in range(th_count):
        headers.append(ths.nth(i).inner_text().strip())

    # Build a column index map with robust matching
    header_map = {normalize_header(h): idx for idx, h in enumerate(headers)}
    # Expected column names (fuzzy)
    # Name column is often titled "Tech Powers" or just first col
    def col_idx(name_variants, default=None):
        for v in name_variants:
            v_norm = normalize_header(v)
            if v_norm in header_map:
                return header_map[v_norm]
        return default

    name_i         = col_idx(["name", "tech powers", "power", "tech power"], 0)
    level_i        = col_idx(["level"], 1)
    casting_i      = col_idx(["casting period", "casting time"], 2)
    range_i        = col_idx(["range"], 3)
    duration_i     = col_idx(["duration"], 4)
    conc_i         = col_idx(["concentration"], 5)
    source_i       = col_idx(["source"], 6)

    data = []
    rows = table.locator("tbody tr")
    for r in range(rows.count()):
        tds = rows.nth(r).locator("td")
        td_count = tds.count()
        # Safe getter
        def get(i):
            if i is None or i >= td_count:
                return ""
            return tds.nth(i).inner_text().strip()

        record = {
            "name":           get(name_i),
            "level":          get(level_i),
            "casting_period": get(casting_i),
            "range":          get(range_i),
            "duration":       get(duration_i),
            "concentration":  get(conc_i),
            "source":         get(source_i) or "PHB",
        }
        # Skip empty rows
        if record["name"]:
            data.append(record)

    return data, headers

def click_next_page_if_possible(page) -> bool:
    """
    Attempts to advance pagination; returns True if next page was clicked.
    Tries several common selectors used by data-table components.
    """
    selectors = [
        'button[aria-label="Next page"]',
        'button[aria-label="Next"]',
        'button[title="Next page"]',
        'button:has-text("Next")',
        'button:has-text("›")',
        'button:has-text("»")',
        # Some libraries use icon-only buttons
        'button .mdi-chevron-right',
        'button .material-icons:has-text("chevron_right")',
    ]

    for sel in selectors:
        el = page.locator(sel)
        if el.count() > 0:
            # If it's an icon inside button, click the button parent
            try:
                if el.first.evaluate("el => el.closest('button') !== null"):
                    el.first.evaluate("el => el.closest('button').click()")
                else:
                    el.first.click()
                return True
            except Exception:
                continue
    return False

def try_set_max_rows(page):
    """
    If there's a 'Rows per page' control, try to set it high to reduce pagination.
    Works best on common MUI/Vuetify tables; safely ignored if not present.
    """
    candidates = [
        "text=Rows per page", "text=Rows Per Page", "text=rows per page",
        "[aria-label='Rows per page']",
    ]
    for c in candidates:
        try:
            control = page.locator(c)
            if control.count() > 0:
                control.first.click(timeout=1000)
                # choose the largest option present
                options = page.locator("ul[role='listbox'] li, [role='menu'] [role='menuitem'], .v-list-item, .MuiMenuItem-root")
                if options.count() > 0:
                    # pick the last one (usually largest)
                    options.nth(options.count()-1).click(timeout=1000)
                break
        except Exception:
            continue

def scrape(url: str, headless: bool = True, timeout_ms: int = 120000) -> list[dict]:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless, args=["--no-sandbox"])
        page = browser.new_page()
        page.set_default_timeout(timeout_ms)
        page.goto(url, wait_until="networkidle")

        # Give the Vue/React table a moment after network idle
        time.sleep(1.0)

        # Try to expand rows per page (best effort)
        try_set_max_rows(page)
        time.sleep(0.5)

        all_rows = []
        seen_names = set()

        while True:
            page.wait_for_selector("table")
            chunk, _ = parse_table(page)
            # Deduplicate across pages by name
            for rec in chunk:
                key = rec["name"]
                if key not in seen_names:
                    seen_names.add(key)
                    all_rows.append(rec)

            # Try to go next; break if not possible or no new data is found after click
            before_count = len(all_rows)
            moved = click_next_page_if_possible(page)
            if not moved:
                break
            # allow next page render
            time.sleep(0.8)
            # If nothing new after navigating, stop to avoid loops
            after_chunk, _ = parse_table(page)
            if not after_chunk or all(r["name"] in seen_names for r in after_chunk):
                break

        browser.close()
        return all_rows

def main():
    ap = argparse.ArgumentParser(description="Scrape SW5e Tech Powers table into JSON.")
    ap.add_argument("--url", default=DEFAULT_URL, help="Page URL (default: %(default)s)")
    ap.add_argument("-o", "--output", default="sw5e_tech_powers.json", help="Output JSON path")
    ap.add_argument("--no-headless", action="store_true", help="Run browser non-headless for debugging")
    args = ap.parse_args()

    try:
        rows = scrape(args.url, headless=not args.no_headless)
    except PlaywrightTimeout:
        print("Timed out waiting for the page/table. Try --no-headless to debug or increase timeout.")
        raise
    except Exception as e:
        print(f"Error while scraping: {e}")
        raise

    # Optional: best-effort coercion of level to int if it looks numeric
    for r in rows:
        lv = r.get("level", "").strip()
        try:
            r["level"] = int(lv)
        except Exception:
            r["level"] = lv  # keep as-is if not an integer

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(rows)} tech powers to {args.output}")

if __name__ == "__main__":
    main()
