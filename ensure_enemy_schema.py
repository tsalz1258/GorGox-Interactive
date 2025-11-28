#!/usr/bin/env python3
"""
Ensure the enemies table in all campaign databases has modern columns.
Adds missing columns such as portrait_url and style if necessary.
"""

import os
import sqlite3
from pathlib import Path

DB_NAMES = [
    "gorgox.db",
    "gorgox_dnd.db",
    "gorgox_starwars.db",
]

COLUMNS_TO_ADD = {
    "portrait_url": "TEXT",
    "style": "TEXT DEFAULT 'dnd'",
}

def ensure_columns(db_path: Path) -> None:
    if not db_path.exists():
        return

    conn = sqlite3.connect(str(db_path))
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(enemies)")
        existing_columns = {row[1] for row in cursor.fetchall()}

        added_any = False
        for column, column_type in COLUMNS_TO_ADD.items():
            if column not in existing_columns:
                cursor.execute(f"ALTER TABLE enemies ADD COLUMN {column} {column_type}")
                added_any = True
        if added_any:
            conn.commit()
    finally:
        conn.close()

def main():
    root = Path(__file__).resolve().parent
    for db_name in DB_NAMES:
        ensure_columns(root / db_name)

if __name__ == "__main__":
    main()



