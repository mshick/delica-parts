# Delica Parts TUI Design

A terminal user interface for browsing the Delica parts database.

## Overview

Personal reference tool to look up parts when working on the Delica. Browse by category hierarchy or search across part numbers, descriptions, and tags. View parts alongside their diagrams.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Framework | Ink (React for terminals) |
| Runtime | Node.js (separate from Deno scraper) |
| Database | `better-sqlite3` (readonly, synchronous) |
| Images | Kitty protocol via `terminal-image` |
| Terminal | Ghostty (Kitty-compatible) |

## Project Structure

```
tui/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.tsx              # Entry point
│   ├── db.ts                  # SQLite queries
│   ├── components/
│   │   ├── Home.tsx           # Vehicle info + groups + search
│   │   ├── GroupView.tsx      # Subgroups menu
│   │   ├── SubgroupView.tsx   # Split: diagram + parts list
│   │   ├── PartDetail.tsx     # Split: diagram + part info
│   │   ├── Search.tsx         # Auto-complete search
│   │   ├── DiagramImage.tsx   # Kitty protocol renderer
│   │   └── ui/                # Menu, SplitPane, etc.
│   └── hooks/
│       └── useDatabase.ts
```

Shares the SQLite database at `../data/delica.db` with the scraper.

## Navigation

Stack-based navigation with simple state:

```typescript
type Screen =
  | { type: 'home' }
  | { type: 'group'; groupId: string }
  | { type: 'subgroup'; subgroupId: string; selectedPartId?: number }
  | { type: 'search'; query: string }
```

**Key bindings:**
- `↑/↓` or `j/k` — navigate menus
- `Enter` — select
- `Esc` — go back one level
- `/` — jump to search from anywhere
- `q` — quit

## Screens

### Home

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DELICA PARTS                                                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 1999 Mitsubishi Delica Space Gear                               │   │
│  │ Frame: PD6W-0500900                                             │   │
│  │ Exterior: W09M   Interior: 57A                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  / Search                                                               │
│                                                                         │
│  › Engine                                                               │
│    Transmission                                                         │
│    Electrical                                                           │
│    Body                                                                 │
│    ...                                                                  │
│                                                                         │
│  ↑↓ navigate   enter select   / search   q quit                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Subgroup (Split View)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ENGINE › Oil Pump & Oil Filter                              esc back   │
├─────────────────────────────────┬───────────────────────────────────────┤
│                                 │                                       │
│                                 │  PARTS                           24   │
│                                 │  ─────────────────────────────────    │
│                                 │                                       │
│    ┌───────────────────────┐    │   › MD360859   Oil Filter             │
│    │                       │    │     MD365876   Oil Pump Assy          │
│    │                       │    │     MD030795   Gasket, Oil Pan        │
│    │      [Diagram]        │    │     MR280796   Oil Pressure Switch    │
│    │                       │    │     MD183595   O-Ring                 │
│    │                       │    │     MD347995   Drain Plug             │
│    │                       │    │                                       │
│    └───────────────────────┘    │                                       │
│                                 │                                       │
│    lubrication-oil-pump-1       │                                       │
│                                 │                                       │
│                                 │  ↑↓ navigate   enter select           │
└─────────────────────────────────┴───────────────────────────────────────┘
```

### Part Detail (Split View)

```
├─────────────────────────────────┬───────────────────────────────────────┤
│                                 │                                       │
│                                 │  MD360859                             │
│                                 │  Oil Filter                           │
│                                 │                                       │
│    ┌───────────────────────┐    │  ─────────────────────────────────    │
│    │                       │    │                                       │
│    │                       │    │  PNC           03195                  │
│    │      [Diagram]        │    │  Ref #         12                     │
│    │                       │    │  Quantity      1                      │
│    │                       │    │  Price         $24.50                 │
│    │                       │    │                                       │
│    └───────────────────────┘    │  Date Range    1994.05 – 2006.08      │
│                                 │                                       │
│    lubrication-oil-pump-1       │  Replaces      MD135737               │
│                                 │                                       │
│                                 │  esc back                             │
└─────────────────────────────────┴───────────────────────────────────────┘
```

### Search

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SEARCH                                                      esc back   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ oil filter█                                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ───────────────────────────────────────────────────────────────────    │
│                                                                         │
│   › MD360859    Oil Filter                          Oil Pump & Filter   │
│     MD135737    Oil Filter (Superseded)             Oil Pump & Filter   │
│     MD332687    Oil Filter Bracket                  Engine              │
│     15400-PLM   Oil Filter (Alternate)              Engine              │
│                                                                         │
│  4 results                                         ↑↓ select   enter    │
└─────────────────────────────────────────────────────────────────────────┘
```

- Queries FTS index with prefix matching
- Results update as you type (debounced ~150ms)
- Enter navigates to part detail with diagram

## Color Scheme

| Element | Color |
|---------|-------|
| Headers, breadcrumbs | Cyan, bold |
| Part numbers | Yellow, bold |
| Descriptions, values | White |
| Labels, hints | Dim gray |
| Selected indicator | Green (›) |
| Counts | Magenta |

## Database Access

Synchronous queries via `better-sqlite3`:

```typescript
import Database from 'better-sqlite3';

const db = new Database('../data/delica.db', { readonly: true });

export const queries = {
  getGroups: () =>
    db.prepare('SELECT * FROM groups ORDER BY name').all(),

  getSubgroups: (groupId: string) =>
    db.prepare('SELECT * FROM subgroups WHERE group_id = ? ORDER BY name')
      .all(groupId),

  getPartsForSubgroup: (subgroupId: string) =>
    db.prepare(`
      SELECT p.*, d.image_path
      FROM parts p
      JOIN diagrams d ON p.diagram_id = d.id
      WHERE p.subgroup_id = ?
      ORDER BY p.ref_number
    `).all(subgroupId),

  getDiagram: (diagramId: string) =>
    db.prepare('SELECT * FROM diagrams WHERE id = ?').get(diagramId),

  searchParts: (query: string) =>
    db.prepare(`
      SELECT p.*, d.image_path, g.name as group_name, s.name as subgroup_name
      FROM parts p
      JOIN parts_fts fts ON p.id = fts.rowid
      JOIN diagrams d ON p.diagram_id = d.id
      JOIN groups g ON p.group_id = g.id
      LEFT JOIN subgroups s ON p.subgroup_id = s.id
      WHERE parts_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).all(query + '*'),
};
```

## Image Rendering

Uses Kitty terminal graphics protocol for Ghostty:

1. Read image from `data/images/`
2. Scale to fit left pane (~40% terminal width)
3. Render via `terminal-image` package or Kitty escape sequences
4. Clear image when navigating away

Fallback: Show file path if image rendering fails.

## Layout

- Split ratio: ~40% diagram, ~60% content
- Scales with terminal width
- Diagram maintains aspect ratio within its pane
