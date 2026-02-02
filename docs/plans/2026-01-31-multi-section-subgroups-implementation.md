# Multi-Section Subgroups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle subgroup pages with multiple `td.detail-list` sections by creating separate subgroups for each, with proper diagram deduplication.

**Architecture:** Add `path` column to track URL origin, new parser function to detect multi-section pages, update scraper to create subgroup+diagram per section upfront, and link parts to pre-created diagrams.

**Tech Stack:** Deno, TypeScript, SQLite (libsql), Cheerio

---

## Task 1: Add `path` Column to Schema and Types

**Files:**
- Modify: `src/types.ts:6-11`
- Modify: `src/db/schema.ts:13-19`

**Step 1: Update Subgroup interface in types.ts**

Add `path` field to the `Subgroup` interface:

```typescript
export interface Subgroup {
  id: string;
  name: string;
  group_id: string;
  path: string;
}
```

**Step 2: Update CREATE TABLE in schema.ts**

Update the subgroups table creation to include the `path` column:

```typescript
  // Subgroups table (subcategories)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS subgroups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id),
      path TEXT NOT NULL
    )
  `);
```

**Step 3: Type-check**

Run: `deno check src/main.ts`
Expected: Compilation errors about missing `path` in `insertSubgroup` calls

**Step 4: Commit**

```bash
git add src/types.ts src/db/schema.ts
git commit -m "feat: add path column to subgroups schema and types"
```

---

## Task 2: Add Schema Migration for `path` Column

**Files:**
- Modify: `src/db/schema.ts:189-282` (runMigrations function)

**Step 1: Add migration for path column**

Add this migration block inside `runMigrations()`, after the existing migrations:

```typescript
  // Migrate subgroups table - add path column
  const subgroupsResult = await client.execute(`PRAGMA table_info(subgroups)`);
  const subgroupsColumns = new Set(subgroupsResult.rows.map((row) => row.name as string));

  if (!subgroupsColumns.has("path")) {
    console.log("  Adding column: subgroups.path");
    await client.execute(`ALTER TABLE subgroups ADD COLUMN path TEXT`);

    // Backfill: set path = id for existing rows
    console.log("  Backfilling subgroups.path = id");
    await client.execute(`UPDATE subgroups SET path = id WHERE path IS NULL`);
  }
```

**Step 2: Test migration runs**

Run: `deno task migrate`
Expected: "Adding column: subgroups.path" message (or no message if already exists)

**Step 3: Verify column exists**

Run: `deno task query "PRAGMA table_info(subgroups)"`
Expected: Output shows `path` column

**Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add migration for subgroups.path column"
```

---

## Task 3: Update `insertSubgroup` Query

**Files:**
- Modify: `src/db/queries.ts:38-52`

**Step 1: Update insertSubgroup to include path**

```typescript
export async function insertSubgroup(
  client: Client,
  subgroup: Subgroup
): Promise<void> {
  // Ensure the parent group exists first
  await client.execute({
    sql: `INSERT OR IGNORE INTO groups (id, name) VALUES (?, ?)`,
    args: [subgroup.group_id, subgroup.group_id],
  });

  await client.execute({
    sql: `INSERT OR IGNORE INTO subgroups (id, name, group_id, path) VALUES (?, ?, ?, ?)`,
    args: [subgroup.id, subgroup.name, subgroup.group_id, subgroup.path],
  });
}
```

**Step 2: Update getSubgroup to return path**

```typescript
export async function getSubgroup(
  client: Client,
  id: string
): Promise<Subgroup | null> {
  const result = await client.execute({
    sql: `SELECT * FROM subgroups WHERE id = ?`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    group_id: row.group_id as string,
    path: row.path as string,
  };
}
```

**Step 3: Type-check**

Run: `deno check src/main.ts`
Expected: Compilation errors about missing `path` in scraper calls

**Step 4: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: update insertSubgroup to include path column"
```

---

## Task 4: Add Slugify Utility

**Files:**
- Create: `src/utils.ts`

**Step 1: Create utils.ts with slugify function**

```typescript
/**
 * Convert a string to a URL-safe slug.
 * - Transliterates common Cyrillic characters to Latin
 * - Lowercases
 * - Replaces non-alphanumeric with dashes
 * - Collapses multiple dashes
 * - Trims leading/trailing dashes
 */
export function slugify(text: string): string {
  // Cyrillic to Latin transliteration map (common characters)
  const cyrillicMap: Record<string, string> = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "А": "a", "Б": "b", "В": "v", "Г": "g", "Д": "d", "Е": "e", "Ё": "e",
    "Ж": "zh", "З": "z", "И": "i", "Й": "y", "К": "k", "Л": "l", "М": "m",
    "Н": "n", "О": "o", "П": "p", "Р": "r", "С": "s", "Т": "t", "У": "u",
    "Ф": "f", "Х": "kh", "Ц": "ts", "Ч": "ch", "Ш": "sh", "Щ": "shch",
    "Ъ": "", "Ы": "y", "Ь": "", "Э": "e", "Ю": "yu", "Я": "ya",
  };

  let result = "";
  for (const char of text) {
    result += cyrillicMap[char] ?? char;
  }

  return result
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // Replace non-alphanumeric with dashes
    .replace(/-+/g, "-")          // Collapse multiple dashes
    .replace(/^-|-$/g, "");       // Trim leading/trailing dashes
}
```

**Step 2: Type-check**

Run: `deno check src/utils.ts`
Expected: No errors

**Step 3: Test manually**

Run: `deno eval "import { slugify } from './src/utils.ts'; console.log(slugify('Схема 1 (NAVIGATION HARNESS(MMCS),ETC.)'))"`
Expected: `skhema-1-navigation-harness-mmcs-etc`

**Step 4: Commit**

```bash
git add src/utils.ts
git commit -m "feat: add slugify utility with Cyrillic transliteration"
```

---

## Task 5: Add `parseDetailListSections` Parser Function

**Files:**
- Modify: `src/scraper/parser.ts`

**Step 1: Add DetailListSection type and import slugify**

At the top of the file, add the import and type:

```typescript
import { slugify } from "../utils.ts";

export interface DetailListSection {
  heading: string;        // h4 text
  slug: string;           // slugified heading for ID suffix
  imageUrl: string | null;
  detailPageIds: string[]; // numeric IDs from detail page links
}
```

**Step 2: Add parseDetailListSections function**

Add this function after `parseDiagramGroups`:

```typescript
/**
 * Parse td.detail-list sections from a subgroup listing page.
 * Each section contains an h4 heading, optional diagram image, and links to detail pages.
 * Returns an array of sections; if length > 1, the page has multiple diagrams.
 */
export function parseDetailListSections(html: string, baseUrl: string): DetailListSection[] {
  const $ = cheerio.load(html);
  const sections: DetailListSection[] = [];

  $("td.detail-list").each((_, td) => {
    const $td = $(td);

    // Extract h4 heading
    const heading = $td.find("h4").first().text().trim();
    if (!heading) return; // Skip sections without headings

    const slug = slugify(heading);
    if (!slug) return; // Skip if slug is empty

    // Extract diagram image URL
    let imageUrl: string | null = null;
    const $img = $td.find("img.parts_picture, img[src*='diagram'], img[src*='scheme']").first();
    if ($img.length > 0) {
      const src = $img.attr("src");
      if (src) {
        imageUrl = src.startsWith("http") ? src : new URL(src, baseUrl).toString();
      }
    }

    // Extract detail page IDs from links
    const detailPageIds: string[] = [];
    $td.find("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const match = href.match(/\/(\d+)\/?(?:\?|$)/);
      if (match) {
        detailPageIds.push(match[1]);
      }
    });

    sections.push({
      heading,
      slug,
      imageUrl,
      detailPageIds,
    });
  });

  return sections;
}
```

**Step 3: Type-check**

Run: `deno check src/scraper/parser.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/scraper/parser.ts
git commit -m "feat: add parseDetailListSections parser function"
```

---

## Task 6: Update Scraper `diagramGroupMap` Type

**Files:**
- Modify: `src/scraper/index.ts:34-35`

**Step 1: Update the diagramGroupMap type**

Change the map from storing heading/imageUrl to storing diagramId/subgroupId:

```typescript
  // Maps detail_page_id to pre-created diagram and subgroup IDs
  private diagramGroupMap: Map<string, { diagramId: string; subgroupId: string }> = new Map();
```

**Step 2: Type-check (expect errors)**

Run: `deno check src/scraper/index.ts`
Expected: Errors in `processSubgroupPage` and `processPartsPage` - this is expected

**Step 3: Commit**

```bash
git add src/scraper/index.ts
git commit -m "refactor: update diagramGroupMap to store diagram and subgroup IDs"
```

---

## Task 7: Update `processSubgroupPage` for Multi-Section Handling

**Files:**
- Modify: `src/scraper/index.ts:181-222`

**Step 1: Update imports**

At the top of the file, update the parser imports:

```typescript
import {
  parseIndexPage,
  parseCategoryPage,
  hasPartsTable,
  parsePartsPage,
  extractPageTitle,
  isSubcategoryListing,
  parseDetailListSections,
} from "./parser.ts";
```

**Step 2: Rewrite processSubgroupPage**

Replace the entire method:

```typescript
  private async processSubgroupPage(
    url: string,
    html: string,
    pathParts: string[]
  ): Promise<void> {
    // pathParts: ["delica_space_gear", "pd6w", "hseue9", "lubrication", "oil-pump-oil-filter"]
    const groupSlug = pathParts[3]; // e.g., "lubrication"
    const subgroupSlug = pathParts[4]; // e.g., "oil-pump-oil-filter"

    if (!groupSlug || !subgroupSlug) return;

    const basePath = `${groupSlug}/${subgroupSlug}`;
    const pageTitle = extractPageTitle(html) || subgroupSlug.replace(/-/g, " ");

    // Parse td.detail-list sections
    const sections = parseDetailListSections(html, url);

    if (sections.length <= 1) {
      // Single section or no sections: preserve current behavior
      const subgroupId = basePath;
      await insertSubgroup(this.client, {
        id: subgroupId,
        name: pageTitle,
        group_id: groupSlug,
        path: basePath,
      });

      console.log(`  Subgroup: ${pageTitle} (group: ${groupSlug})`);

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

        // Map each detail page ID to this diagram/subgroup
        for (const detailId of sections[0].detailPageIds) {
          this.diagramGroupMap.set(detailId, { diagramId, subgroupId });
        }
        console.log(`    Diagram created with ${sections[0].detailPageIds.length} parts`);
      }
    } else {
      // Multiple sections: create subgroup + diagram per section
      console.log(`  Subgroup: ${pageTitle} with ${sections.length} diagram sections`);

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

        // Map each detail page ID to this diagram/subgroup
        for (const detailId of section.detailPageIds) {
          this.diagramGroupMap.set(detailId, { diagramId, subgroupId });
        }

        console.log(`    - "${section.heading}": ${section.detailPageIds.length} parts`);
      }
    }
  }
```

**Step 3: Type-check (expect errors in processPartsPage)**

Run: `deno check src/scraper/index.ts`
Expected: Errors only in `processPartsPage` - will fix in next task

**Step 4: Commit**

```bash
git add src/scraper/index.ts
git commit -m "feat: update processSubgroupPage for multi-section handling"
```

---

## Task 8: Update `processPartsPage` to Use Pre-Created Diagrams

**Files:**
- Modify: `src/scraper/index.ts:224-303`

**Step 1: Rewrite processPartsPage**

Replace the entire method:

```typescript
  private async processPartsPage(
    url: string,
    html: string,
    pathParts: string[]
  ): Promise<void> {
    // pathParts: ["delica_space_gear", "pd6w", "hseue9", "lubrication", "oil-pump-oil-filter", "11778"]
    const detailPageId = pathParts[5] || null;
    const groupSlug = pathParts[3] || "unknown";
    const subgroupSlug = pathParts[4];

    // Look up pre-created diagram/subgroup from subgroup page processing
    const mapping = detailPageId ? this.diagramGroupMap.get(detailPageId) : null;

    if (mapping) {
      // Diagram already exists - just parse and insert parts
      const { diagram, parts } = parsePartsPage(html, url, mapping.diagramId);
      const pnc = parts.length > 0 ? parts[0].pnc : null;

      console.log(`  Parts page: ${diagram.name}, PNC: ${pnc || "unknown"}, ${parts.length} variant(s) found`);

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
      // Fallback: no mapping found (page visited before subgroup page, or single-page subgroup)
      // Create diagram on demand (preserves old behavior for edge cases)
      const diagramId = pathParts.slice(3).join("-").replace(/,/g, "_");
      const { diagram, parts } = parsePartsPage(html, url, diagramId);
      const pnc = parts.length > 0 ? parts[0].pnc : null;

      console.log(`  Parts page (fallback): ${diagram.name}, PNC: ${pnc || "unknown"}, ${parts.length} variant(s) found`);

      // Ensure parent group exists
      await insertGroup(this.client, {
        id: groupSlug,
        name: groupSlug,
      });

      // Ensure subgroup exists
      const subgroupId = subgroupSlug ? `${groupSlug}/${subgroupSlug}` : null;
      if (subgroupSlug) {
        const subgroupName = extractPageTitle(html) || subgroupSlug.replace(/-/g, " ");
        await insertSubgroup(this.client, {
          id: subgroupId!,
          name: subgroupName,
          group_id: groupSlug,
          path: subgroupId!,
        });
      }

      // Create diagram
      const diagramRecord: Diagram = {
        id: diagram.id,
        group_id: groupSlug,
        subgroup_id: subgroupId,
        name: diagram.name,
        image_url: diagram.imageUrl,
        image_path: null,
        source_url: url,
      };
      await insertDiagram(this.client, diagramRecord);

      // Save parts
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
          diagram_id: diagram.id,
          group_id: groupSlug,
          subgroup_id: subgroupId,
          replacement_part_number: null,
        }));
        await insertParts(this.client, partRecords);
      }
    }
  }
```

**Step 2: Type-check**

Run: `deno check src/main.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/scraper/index.ts
git commit -m "feat: update processPartsPage to use pre-created diagrams"
```

---

## Task 9: Create Migration Script

**Files:**
- Create: `scripts/migrate-multi-section-subgroups.ts`

**Step 1: Create the migration script**

```typescript
/**
 * Migration script for multi-section subgroups.
 *
 * This script:
 * 1. Adds the `path` column to subgroups if missing
 * 2. Detects subgroup pages with multiple td.detail-list sections
 * 3. For affected pages: deletes old data, creates new subgroups/diagrams, re-scrapes parts
 *
 * Run with: deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net scripts/migrate-multi-section-subgroups.ts
 */

import { getClient, closeClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/schema.ts";
import {
  insertSubgroup,
  insertDiagram,
  insertParts,
} from "../src/db/queries.ts";
import {
  parseDetailListSections,
  parsePartsPage,
  extractPageTitle,
} from "../src/scraper/parser.ts";
import { RateLimitedFetcher } from "../src/scraper/fetcher.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import type { Client } from "@libsql/client";
import type { Part } from "../src/types.ts";

async function main() {
  console.log("Multi-Section Subgroups Migration");
  console.log("==================================\n");

  const client = getClient(DEFAULT_CONFIG.dbPath);
  const fetcher = new RateLimitedFetcher(DEFAULT_CONFIG);

  try {
    // Step 1: Run schema migrations (adds path column if needed)
    console.log("Step 1: Running schema migrations...");
    await runMigrations(client);
    console.log("  Done.\n");

    // Step 2: Find all completed subgroup URLs
    console.log("Step 2: Finding subgroup pages to check...");
    const subgroupUrls = await getSubgroupUrls(client);
    console.log(`  Found ${subgroupUrls.length} subgroup pages.\n`);

    // Step 3: Check each page for multiple sections
    console.log("Step 3: Checking for multi-section pages...");
    const affectedPages: Array<{
      url: string;
      basePath: string;
      groupSlug: string;
      pageTitle: string;
      sections: ReturnType<typeof parseDetailListSections>;
    }> = [];

    for (const url of subgroupUrls) {
      const result = await fetcher.fetch(url);
      if (!result.ok || !result.html) {
        console.log(`  Skipping ${shortenUrl(url)}: fetch failed`);
        continue;
      }

      const sections = parseDetailListSections(result.html, url);
      if (sections.length > 1) {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split("/").filter(Boolean);
        const groupSlug = pathParts[3];
        const subgroupSlug = pathParts[4];
        const basePath = `${groupSlug}/${subgroupSlug}`;
        const pageTitle = extractPageTitle(result.html) || subgroupSlug.replace(/-/g, " ");

        affectedPages.push({ url, basePath, groupSlug, pageTitle, sections });
        console.log(`  Found: ${basePath} (${sections.length} sections)`);
      }
    }

    if (affectedPages.length === 0) {
      console.log("  No multi-section pages found. Nothing to migrate.\n");
      return;
    }

    console.log(`\n  Found ${affectedPages.length} multi-section pages to migrate.\n`);

    // Step 4: Migrate each affected page
    console.log("Step 4: Migrating affected pages...");
    let totalSubgroups = 0;
    let totalParts = 0;

    for (const page of affectedPages) {
      console.log(`\n  Migrating: ${page.basePath}`);

      // Delete existing data for this subgroup path
      await deleteSubgroupData(client, page.basePath);

      // Create new subgroups and diagrams for each section
      for (const section of page.sections) {
        const subgroupId = `${page.basePath}/${section.slug}`;
        const subgroupName = `${page.pageTitle} - ${section.heading}`;

        await insertSubgroup(client, {
          id: subgroupId,
          name: subgroupName,
          group_id: page.groupSlug,
          path: page.basePath,
        });

        await insertDiagram(client, {
          id: subgroupId,
          group_id: page.groupSlug,
          subgroup_id: subgroupId,
          name: section.heading,
          image_url: section.imageUrl,
          image_path: null,
          source_url: page.url,
        });

        totalSubgroups++;
        console.log(`    Created subgroup: ${section.heading}`);

        // Fetch and insert parts for each detail page in this section
        for (const detailId of section.detailPageIds) {
          const detailUrl = buildDetailUrl(page.basePath, detailId);
          const detailResult = await fetcher.fetch(detailUrl);

          if (!detailResult.ok || !detailResult.html) {
            console.log(`      Skipping detail ${detailId}: fetch failed`);
            continue;
          }

          const { parts } = parsePartsPage(detailResult.html, detailUrl, subgroupId);

          if (parts.length > 0) {
            const partRecords: Part[] = parts.map((p) => ({
              detail_page_id: detailId,
              part_number: p.partNumber,
              pnc: p.pnc,
              description: p.description,
              ref_number: p.refNumber,
              quantity: p.quantity,
              spec: p.spec,
              notes: p.notes,
              color: p.color,
              model_date_range: p.modelDateRange,
              diagram_id: subgroupId,
              group_id: page.groupSlug,
              subgroup_id: subgroupId,
              replacement_part_number: null,
            }));
            await insertParts(client, partRecords);
            totalParts += parts.length;
          }
        }
      }
    }

    // Step 5: Download images for new diagrams
    console.log("\n\nStep 5: Downloading images for new diagrams...");
    await downloadNewImages(client, fetcher);

    // Summary
    console.log("\n\nMigration Complete!");
    console.log("==================");
    console.log(`  Pages migrated: ${affectedPages.length}`);
    console.log(`  Subgroups created: ${totalSubgroups}`);
    console.log(`  Parts inserted: ${totalParts}`);

  } finally {
    await closeClient();
  }
}

async function getSubgroupUrls(client: Client): Promise<string[]> {
  // Find URLs that are subgroup listing pages (have exactly 5 path segments)
  const result = await client.execute(`
    SELECT url FROM scrape_progress
    WHERE status = 'completed'
    AND url LIKE '%/delica_space_gear/pd6w/hseue9/%'
  `);

  return result.rows
    .map((row) => row.url as string)
    .filter((url) => {
      const pathParts = new URL(url).pathname.split("/").filter(Boolean);
      // Subgroup pages have: delica_space_gear/pd6w/hseue9/group/subgroup (5 parts)
      return pathParts.length === 5;
    });
}

async function deleteSubgroupData(client: Client, basePath: string): Promise<void> {
  // Delete parts linked to subgroups with this path
  await client.execute({
    sql: `DELETE FROM parts WHERE subgroup_id IN (
      SELECT id FROM subgroups WHERE path = ? OR id = ?
    )`,
    args: [basePath, basePath],
  });

  // Delete diagrams linked to subgroups with this path
  await client.execute({
    sql: `DELETE FROM diagrams WHERE subgroup_id IN (
      SELECT id FROM subgroups WHERE path = ? OR id = ?
    )`,
    args: [basePath, basePath],
  });

  // Delete subgroups with this path
  await client.execute({
    sql: `DELETE FROM subgroups WHERE path = ? OR id = ?`,
    args: [basePath, basePath],
  });
}

function buildDetailUrl(basePath: string, detailId: string): string {
  return `https://mitsubishi.epc-data.com/delica_space_gear/pd6w/hseue9/${basePath}/${detailId}/?frame_no=${DEFAULT_CONFIG.frameNumber}`;
}

function shortenUrl(url: string): string {
  return url.replace("https://mitsubishi.epc-data.com/delica_space_gear/pd6w/hseue9/", "/");
}

async function downloadNewImages(client: Client, fetcher: RateLimitedFetcher): Promise<void> {
  const result = await client.execute(
    `SELECT * FROM diagrams WHERE image_url IS NOT NULL AND image_path IS NULL`
  );

  if (result.rows.length === 0) {
    console.log("  No new images to download.");
    return;
  }

  console.log(`  Downloading ${result.rows.length} images...`);

  // Ensure images directory exists
  try {
    await Deno.mkdir(DEFAULT_CONFIG.imagesDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }

  let downloaded = 0;
  let failed = 0;

  for (const row of result.rows) {
    const imageUrl = row.image_url as string;
    const diagramId = row.id as string;

    const safeId = diagramId.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 100);
    const ext = imageUrl.match(/\.([a-z]+)(?:\?|$)/i)?.[1] || "png";
    const filename = `${safeId}.${ext}`;
    const imagePath = `${DEFAULT_CONFIG.imagesDir}/${filename}`;

    const imageResult = await fetcher.fetchImage(imageUrl);

    if (imageResult.ok && imageResult.data) {
      try {
        await Deno.writeFile(imagePath, imageResult.data);
        await client.execute({
          sql: `UPDATE diagrams SET image_path = ? WHERE id = ?`,
          args: [imagePath, diagramId],
        });
        downloaded++;
      } catch {
        failed++;
      }
    } else {
      failed++;
    }
  }

  console.log(`  Downloaded: ${downloaded}, Failed: ${failed}`);
}

main();
```

**Step 2: Type-check**

Run: `deno check scripts/migrate-multi-section-subgroups.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add scripts/migrate-multi-section-subgroups.ts
git commit -m "feat: add migration script for multi-section subgroups"
```

---

## Task 10: Run Migration and Verify

**Step 1: Run the migration**

Run: `deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net scripts/migrate-multi-section-subgroups.ts`

Expected: Script reports found multi-section pages, migrates them, downloads images

**Step 2: Verify results**

Run: `deno task query "SELECT COUNT(*) FROM subgroups WHERE path != id"`
Expected: Shows count of new multi-section subgroups

Run: `deno task query "SELECT id, name, path FROM subgroups WHERE path != id LIMIT 10"`
Expected: Shows new subgroups with different id and path values

**Step 3: Check status**

Run: `deno task status`
Expected: Updated counts for subgroups, diagrams

**Step 4: Commit any database changes note**

This step modifies the database. If testing on a copy, no commit needed.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add path column to schema/types | `types.ts`, `schema.ts` |
| 2 | Add schema migration | `schema.ts` |
| 3 | Update insertSubgroup query | `queries.ts` |
| 4 | Add slugify utility | `utils.ts` (new) |
| 5 | Add parseDetailListSections parser | `parser.ts` |
| 6 | Update diagramGroupMap type | `index.ts` |
| 7 | Rewrite processSubgroupPage | `index.ts` |
| 8 | Rewrite processPartsPage | `index.ts` |
| 9 | Create migration script | `scripts/migrate-multi-section-subgroups.ts` (new) |
| 10 | Run migration and verify | (runtime) |
