# Bookmarks Feature Design

## Overview

Add the ability to bookmark parts in the TUI for quick access later. Bookmarks persist to the database and can be viewed from a dedicated Bookmarks screen accessible from the home menu.

## Database Schema

New `bookmarks` table:

```sql
CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);
```

- `UNIQUE` on `part_id` prevents duplicate bookmarks
- `ON DELETE CASCADE` removes bookmark if part is deleted
- `created_at` enables ordering by most recently added

## Database Queries

New functions in `tui/src/db.ts`:

```typescript
addBookmark(partId: number): boolean      // Returns true if added, false if exists
removeBookmark(partId: number): void
isBookmarked(partId: number): boolean
getBookmarks(): Array<{
  id: number;
  part_id: number;
  part_number: string;
  pnc: string | null;
  description: string | null;
  group_name: string;
  subgroup_name: string | null;
  created_at: string;
}>
```

The `getBookmarks` query JOINs `parts`, `groups`, and `subgroups` for full context, ordered by `created_at DESC`.

## UI Changes

### PartDetail Screen
- `b` key toggles bookmark on/off
- Hint area shows: `b bookmark` or `b unbookmark` based on current state

### Home Screen
- New menu item: "★ BOOKMARKS" with count hint (e.g., `3 saved`)
- Positioned between Search and the separator before groups
- Omit count hint if zero bookmarks

### Bookmarks Screen (new)
- Header: `BOOKMARKS`
- List format matches search results: `[PNC] PART-NUMBER` with hint `DESCRIPTION — GROUP › SUBGROUP`
- Empty state: `No bookmarks yet`
- `enter` navigates to part detail
- `esc` returns to home
- Uses existing Menu component with scrolling

## Navigation State

Add to `state.ts`:

```typescript
| { type: 'bookmarks' }
```

Navigation flow:
- Home → Bookmarks → PartDetail → (back) → Bookmarks → (back) → Home

Bookmark status is read fresh from database on each PartDetail render (no caching needed).

## Files to Modify

1. `src/db/schema.ts` - Add bookmarks table creation
2. `tui/src/db.ts` - Add bookmark query functions
3. `tui/src/state.ts` - Add bookmarks screen type
4. `tui/src/components/PartDetail.tsx` - Add bookmark toggle
5. `tui/src/components/Home.tsx` - Add bookmarks menu item
6. `tui/src/components/Bookmarks.tsx` - New component
7. `tui/src/index.tsx` - Add bookmarks screen routing
