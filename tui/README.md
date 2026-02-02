# Delica TUI (Go)

Terminal user interface for browsing the Delica parts database, built with [Bubble Tea](https://github.com/charmbracelet/bubbletea).

## Prerequisites

- Go 1.21+
- A Kitty-compatible terminal (Ghostty, Kitty, etc.) for diagram images

## Build

```bash
go build -o delica-tui
```

## Run

```bash
./delica-tui -root /path/to/project
```

The `-root` flag should point to the project root containing:
- `data/delica.db` - SQLite database
- `data/images/` - Diagram images

Example from this directory:

```bash
./delica-tui -root ..
```

Or run directly without building:

```bash
go run . -root ..
```

## Navigation

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` | Select |
| `Esc` | Go back |
| `/` | Search (from any screen) |
| `b` | Toggle bookmark (on part detail) |
| `q` | Quit |

## Screens

- **Home** - Vehicle info, search, bookmarks, and parts groups
- **Group** - Subgroups within a category
- **Subgroup** - Split view with diagram and parts list
- **Part Detail** - Split view with diagram and part info
- **Search** - Full-text search across parts
- **Bookmarks** - Saved parts for quick access
