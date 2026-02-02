# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Delica Parts Scraper is a tool for scraping and browsing parts data from the Mitsubishi Delica Space Gear EPC (Electronic Parts Catalog). It includes:
- A Deno-based web scraper that downloads parts data and diagram images
- A Go-based terminal user interface (TUI) for browsing parts
- SQLite database with full-text search

## The Vehicle

Vehicle configuration is stored in `.env` at the project root. Run `make bootstrap` to configure.

## Commands

Use the Makefile for all common operations:

```bash
make bootstrap    # Configure vehicle and fetch details
make scrape       # Start or resume scraping parts data
make status       # Show scraping progress
make migrate      # Run database migrations
make tui          # Launch the terminal user interface
make build        # Build the TUI binary
make clean        # Remove build artifacts and data
```

## Project Structure

```
├── scraper/              # Deno scraper
│   ├── src/             # Source code
│   │   ├── main.ts      # CLI entry point
│   │   ├── types.ts     # Type definitions and config
│   │   ├── db/          # Database operations
│   │   └── scraper/     # Web scraping logic
│   ├── scripts/         # Utility scripts (bootstrap, rescrape)
│   └── deno.json        # Deno configuration
├── tui/                  # Go TUI
│   ├── main.go          # Entry point
│   ├── model/           # Screen models (home, group, subgroup, part, search, bookmarks)
│   ├── ui/              # UI components (menu, splitpane, keys, styles)
│   ├── db/              # Database queries
│   └── image/           # Kitty image protocol support
├── data/                # SQLite database and images (gitignored)
├── .env                 # Vehicle configuration (gitignored)
└── Makefile             # Build commands
```

## TUI Navigation

- `↑/↓` or `j/k` — navigate menus
- `Enter` — select item or open link
- `Esc` — go back
- `/` — search (from any screen)
- `b` — toggle bookmark (on part detail)
- `n` — add/edit note (on part detail)
- `q` — quit

## Database Schema

- **groups** → top-level categories (e.g., "engine", "lubrication")
- **subgroups** → subcategories linked to groups
- **diagrams** → parts diagrams with image URLs and local paths
- **parts** → individual parts with part_number, PNC, description, specs
- **bookmarks** → user-saved parts
- **notes** → user notes attached to parts
- **scrape_progress** → URL tracking (pending/completed/failed)
- **parts_fts** → FTS5 virtual table for full-text search

Key relationships: `parts → diagram → subgroup → group`

## Configuration

Environment variables in `.env`:
- `FRAME_NO` - Full frame number (e.g., PD6W-0500904)
- `VEHICLE_NAME` - Display name from EPC
- `FRAME_NAME` - Frame code for URLs (e.g., pd6w)
- `TRIM_CODE` - Trim/complectation code (e.g., hseue9)
- `EXTERIOR_CODE` - Exterior color code
- `INTERIOR_CODE` - Interior color code
- `MANUFACTURE_DATE` - Build date

## Scraper Details

### Rate Limiting

The fetcher uses adaptive rate limiting:
- Initial delay: 3 seconds
- Range: 1 second to 2 minutes
- Exponential backoff (1.5x) on rate limits/errors
- Speed-up (0.85x) after 60s of successful requests

### Migrations

Schema migrations in `scraper/src/db/schema.ts` are idempotent and run automatically on startup.
