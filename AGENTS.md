# Vertex City v3, active project

This is the Vertex City trunk as of 2026-09-12. Work here.

- **Path:** `/home/chris/CODING/EXPERIMENT/new_ascii_city/v3`
- **Package:** `vertex-city`, version `3.0.0-preview`
- **Run:** `npm start` (serves on port 8792 via `portbroker get --name vertex-city`)
- **Check:** `npm run check` (lint + tests), `npm run benchmark` for render timing

**Read `HANDOFF.md` in full before changing code.** It holds the standing
orders, the core invariants, and the current state. This file only exists to
tell you which directory is the real one.

## Do not edit these, they are superseded

| Path | What it was |
| --- | --- |
| `/home/chris/CODING/EXPERIMENT/ASCII-City-2.0` | v2 line, GitHub `tweakyourpc/ascii-city-2`, port 8776 |
| `/home/chris/CODING/EXPERIMENT/ASCII` | v1 line, GitHub `tweakyourpc/ascii-city`, port 8768 |
| `/home/chris/CODING/EXPERIMENT/new_ascii_city/` (parent) | Unrelated older Python explorer (`app.js`, `engine.js`, `server.py`). Shares the parent directory by accident only. |

## Known failing test

`test/readable.test.js`, "mesh attributes remain finite and triangles retain
exact footprint wall planes". Pre-existing at import, 232/233 pass. Do not
report it as something you broke.
