# Multi-Section Subgroups Design

## Problem

Some subgroup pages (e.g., "Wiring & attaching parts") contain multiple diagrams within `td.detail-list` sections. Currently these are treated as a single subgroup, and diagram images are duplicated for each part detail page.

## Solution

Detect multi-section subgroup pages and create separate subgroups for each `td.detail-list` section. Each section gets one subgroup and one diagram record, with multiple parts linked to that shared diagram.

## Schema Changes

### Subgroups Table

Add `path` column to track the original URL slug:

```sql
ALTER TABLE subgroups ADD COLUMN path TEXT;
```

**Data model:**

| Column | Description |
|--------|-------------|
| `id` | Unique identifier: `"{group}/{subgroup}"` for single-section, `"{group}/{subgroup}/{section-slug}"` for multi-section |
| `name` | Display name: `"{page title}"` for single-section, `"{page title} - {h4 text}"` for multi-section |
| `group_id` | Foreign key to groups |
| `path` | Original URL slug, shared by sections from same page: `"{group}/{subgroup}"` |

**Example after migration:**

| id | name | group_id | path |
|----|------|----------|------|
| `chassis-electrical/wiring-attaching-parts/navigation-harness-mmcs-etc` | Wiring & attaching parts - Схема 1 (NAVIGATION HARNESS(MMCS),ETC.) | chassis-electrical | `chassis-electrical/wiring-attaching-parts` |
| `chassis-electrical/wiring-attaching-parts/engine-harness-etc` | Wiring & attaching parts - Схема 2 (ENGINE HARNESS,ETC.) | chassis-electrical | `chassis-electrical/wiring-attaching-parts` |

### Types

Update `src/types.ts`:

```typescript
export interface Subgroup {
  id: string;
  name: string;
  group_id: string;
  path: string;  // new field
}
```

## Parser Changes

### New Function: `parseDetailListSections()`

Add to `src/scraper/parser.ts`:

```typescript
export interface DetailListSection {
  heading: string;        // h4 text
  slug: string;           // slugified heading for ID suffix
  imageUrl: string | null;
  detailPageIds: string[]; // numeric IDs from detail page links
}

export function parseDetailListSections(html: string, baseUrl: string): DetailListSection[]
```

**Logic:**
1. Find all `td.detail-list` elements
2. For each: extract `h4` text, diagram image URL, and detail page link IDs
3. Slugify the h4 text (lowercase, non-alphanumeric → dashes, collapse multiples)
4. Return array of sections

**Slugify rules:**
- Transliterate Cyrillic to Latin (or strip if too complex)
- Lowercase
- Replace non-alphanumeric with dashes
- Collapse multiple dashes
- Trim leading/trailing dashes

## Scraper Changes

### Updated `diagramGroupMap`

Change from:
```typescript
private diagramGroupMap: Map<string, { heading: string; imageUrl: string | null }> = new Map();
```

To:
```typescript
private diagramGroupMap: Map<string, { diagramId: string; subgroupId: string }> = new Map();
```

### Updated `processSubgroupPage()`

```typescript
private async processSubgroupPage(url: string, html: string, pathParts: string[]): Promise<void> {
  const groupSlug = pathParts[3];
  const subgroupSlug = pathParts[4];
  const basePath = `${groupSlug}/${subgroupSlug}`;
  const pageTitle = extractPageTitle(html) || subgroupSlug.replace(/-/g, " ");

  const sections = parseDetailListSections(html, url);

  if (sections.length <= 1) {
    // Single section: preserve current behavior
    const subgroupId = basePath;
    await insertSubgroup(this.client, {
      id: subgroupId,
      name: pageTitle,
      group_id: groupSlug,
      path: basePath,
    });

    // Create diagram if section has image
    if (sections.length === 1 && sections[0].imageUrl) {
      const diagramId = subgroupId;
      await insertDiagram(this.client, {
        id: diagramId,
        group_id: groupSlug,
        subgroup_id: subgroupId,
        name: pageTitle,
        image_url: sections[0].imageUrl,
        image_path: null,
        source_url: url,
      });

      for (const detailId of sections[0].detailPageIds) {
        this.diagramGroupMap.set(detailId, { diagramId, subgroupId });
      }
    }
  } else {
    // Multiple sections: create subgroup + diagram per section
    for (const section of sections) {
      const subgroupId = `${basePath}/${section.slug}`;
      const diagramId = subgroupId;
      const subgroupName = `${pageTitle} - ${section.heading}`;

      await insertSubgroup(this.client, {
        id: subgroupId,
        name: subgroupName,
        group_id: groupSlug,
        path: basePath,
      });

      await insertDiagram(this.client, {
        id: diagramId,
        group_id: groupSlug,
        subgroup_id: subgroupId,
        name: section.heading,
        image_url: section.imageUrl,
        image_path: null,
        source_url: url,
      });

      for (const detailId of section.detailPageIds) {
        this.diagramGroupMap.set(detailId, { diagramId, subgroupId });
      }
    }
  }
}
```

### Updated `processPartsPage()`

```typescript
private async processPartsPage(url: string, html: string, pathParts: string[]): Promise<void> {
  const detailPageId = pathParts[5] || null;
  const groupSlug = pathParts[3] || "unknown";

  // Look up pre-created diagram/subgroup from subgroup page processing
  const mapping = detailPageId ? this.diagramGroupMap.get(detailPageId) : null;

  if (mapping) {
    // Diagram already exists - just insert parts
    const { parts } = parsePartsPage(html, url, mapping.diagramId);

    if (parts.length > 0) {
      const partRecords: Part[] = parts.map((p) => ({
        detail_page_id: detailPageId,
        part_number: p.partNumber,
        pnc: p.pnc,
        description: p.description,
        ref_number: p.refNumber,
        quantity: p.quantity,
        spec: p.spec,
        notes: p.notes,
        color: p.color,
        model_date_range: p.modelDateRange,
        diagram_id: mapping.diagramId,
        group_id: groupSlug,
        subgroup_id: mapping.subgroupId,
        replacement_part_number: null,
      }));
      await insertParts(this.client, partRecords);
    }
  } else {
    // Fallback: no mapping found (shouldn't happen normally)
    // ... existing fallback logic for creating diagram ...
  }
}
```

## Migration Script

Create `scripts/migrate-multi-section-subgroups.ts` as an all-in-one script:

### Step 1: Schema Update
- Add `path` column if missing
- Backfill `path = id` for all existing rows

### Step 2: Detect & Migrate Affected Pages
For each subgroup URL in `scrape_progress`:
1. Fetch the page (respecting rate limits)
2. Run `parseDetailListSections()`
3. If count > 1:
   - Delete parts where `subgroup_id` matches the old ID
   - Delete diagrams where `subgroup_id` matches
   - Delete the subgroup row
   - Create new subgroups/diagrams per section
   - Fetch each detail page and insert parts with correct linkages
   - Download diagram images

### Step 3: Report
- Print summary: pages processed, subgroups created, parts migrated

## Files to Change

| File | Changes |
|------|---------|
| `src/types.ts` | Add `path: string` to `Subgroup` interface |
| `src/db/schema.ts` | Add `path` column in `CREATE TABLE`, add migration |
| `src/db/queries.ts` | Update `insertSubgroup()` to include `path` |
| `src/scraper/parser.ts` | Add `DetailListSection` type and `parseDetailListSections()` |
| `src/scraper/index.ts` | Update `diagramGroupMap` type, `processSubgroupPage()`, `processPartsPage()` |
| `scripts/migrate-multi-section-subgroups.ts` | **New** - all-in-one migration script |

## Behavior Summary

| Page Type | Subgroup ID | Subgroup Name | Diagram Count |
|-----------|-------------|---------------|---------------|
| Single section | `group/subgroup` | Page title | 1 per subgroup |
| Multi-section | `group/subgroup/section-slug` | Page title - h4 text | 1 per section |

## Open Questions

None - design is complete.
