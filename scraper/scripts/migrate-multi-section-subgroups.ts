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
  // First, delete from tags_to_parts (references parts without CASCADE)
  await client.execute({
    sql: `DELETE FROM tags_to_parts WHERE part_id IN (
      SELECT id FROM parts WHERE subgroup_id IN (
        SELECT id FROM subgroups WHERE path = ? OR id = ?
      )
    )`,
    args: [basePath, basePath],
  });

  // Delete from bookmarks (has CASCADE but being explicit)
  await client.execute({
    sql: `DELETE FROM bookmarks WHERE part_id IN (
      SELECT id FROM parts WHERE subgroup_id IN (
        SELECT id FROM subgroups WHERE path = ? OR id = ?
      )
    )`,
    args: [basePath, basePath],
  });

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
