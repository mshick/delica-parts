/**
 * Re-scrape all subgroup pages to ensure all parts are captured.
 * This fixes issues with comma-separated detail page IDs that were missed.
 *
 * Run with: deno run --allow-read --allow-write --allow-env --allow-ffi --allow-net scripts/rescrape-all-subgroups.ts
 */

import { load as loadEnv } from "@std/dotenv";

// Load .env file from project root before importing config
await loadEnv({ envPath: "../.env", export: true });

import { getClient, closeClient } from "../src/db/client.ts";
import { runMigrations } from "../src/db/schema.ts";
import {
  insertSubgroup,
  insertDiagram,
  insertParts,
  mergeReplacementParts,
} from "../src/db/queries.ts";
import {
  parseDetailListSections,
  parsePartsPage,
  extractPageTitle,
} from "../src/scraper/parser.ts";
import { cleanSubgroupName } from "../src/utils.ts";
import { RateLimitedFetcher } from "../src/scraper/fetcher.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import type { Client } from "@libsql/client";
import type { Part } from "../src/types.ts";

async function main() {
  console.log("Re-scrape All Subgroups");
  console.log("=======================\n");

  const client = getClient(DEFAULT_CONFIG.dbPath);
  const fetcher = new RateLimitedFetcher(DEFAULT_CONFIG);

  try {
    // Step 1: Run schema migrations
    console.log("Step 1: Running schema migrations...");
    await runMigrations(client);
    console.log("  Done.\n");

    // Step 2: Find all subgroup URLs
    console.log("Step 2: Finding subgroup pages...");
    const subgroupUrls = await getSubgroupUrls(client);
    console.log(`  Found ${subgroupUrls.length} subgroup pages.\n`);

    // Step 3: Process each subgroup
    console.log("Step 3: Re-scraping subgroups...\n");
    let totalParts = 0;
    let pagesProcessed = 0;

    for (const url of subgroupUrls) {
      const result = await fetcher.fetch(url);
      if (!result.ok || !result.html) {
        console.log(`  Skipping ${shortenUrl(url)}: fetch failed`);
        continue;
      }

      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      const groupSlug = pathParts[3];
      const subgroupSlug = pathParts[4];
      const basePath = `${groupSlug}/${subgroupSlug}`;
      const pageTitle = cleanSubgroupName(extractPageTitle(result.html) || subgroupSlug.replace(/-/g, " "));

      const sections = parseDetailListSections(result.html, url);

      if (sections.length === 0) {
        continue;
      }

      console.log(`  Processing: ${basePath} (${sections.length} section(s))`);
      pagesProcessed++;

      // Build diagram map for this subgroup
      const diagramMap = new Map<string, { diagramId: string; subgroupId: string }>();

      if (sections.length === 1) {
        // Single section
        const subgroupId = basePath;
        const diagramId = subgroupId;

        await insertSubgroup(client, {
          id: subgroupId,
          name: pageTitle,
          group_id: groupSlug,
          path: basePath,
        });

        if (sections[0].imageUrl) {
          await insertDiagram(client, {
            id: diagramId,
            group_id: groupSlug,
            subgroup_id: subgroupId,
            name: pageTitle,
            image_url: sections[0].imageUrl,
            image_path: null,
            source_url: url,
          });
        }

        for (const detailId of sections[0].detailPageIds) {
          diagramMap.set(detailId, { diagramId, subgroupId });
        }
      } else {
        // Multiple sections
        for (const section of sections) {
          const subgroupId = `${basePath}/${section.slug}`;
          const diagramId = subgroupId;
          const cleanedHeading = cleanSubgroupName(section.heading);
          const subgroupName = `${pageTitle} - ${cleanedHeading}`;

          await insertSubgroup(client, {
            id: subgroupId,
            name: subgroupName,
            group_id: groupSlug,
            path: basePath,
          });

          await insertDiagram(client, {
            id: diagramId,
            group_id: groupSlug,
            subgroup_id: subgroupId,
            name: cleanedHeading,
            image_url: section.imageUrl,
            image_path: null,
            source_url: url,
          });

          for (const detailId of section.detailPageIds) {
            diagramMap.set(detailId, { diagramId, subgroupId });
          }
        }
      }

      // Process each detail page
      for (const [detailId, mapping] of diagramMap) {
        // Check if we already have parts for this detail page
        const existingParts = await client.execute({
          sql: `SELECT COUNT(*) as count FROM parts WHERE detail_page_id = ?`,
          args: [detailId],
        });

        if ((existingParts.rows[0].count as number) > 0) {
          continue; // Already have parts
        }

        // Fetch and parse detail page
        const detailUrl = `${DEFAULT_CONFIG.baseUrl}${basePath}/${detailId}/?frame_no=${DEFAULT_CONFIG.frameNumber}`;
        const detailResult = await fetcher.fetch(detailUrl);

        if (!detailResult.ok || !detailResult.html) {
          console.log(`    Skipping detail ${detailId}: fetch failed`);
          continue;
        }

        const { parts } = parsePartsPage(detailResult.html, detailUrl, mapping.diagramId);

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
            diagram_id: mapping.diagramId,
            group_id: groupSlug,
            subgroup_id: mapping.subgroupId,
            replacement_part_number: null,
          }));
          await insertParts(client, partRecords);
          totalParts += parts.length;
          console.log(`    Detail ${detailId}: ${parts.length} parts`);
        }
      }
    }

    // Step 4: Merge replacement parts
    console.log("\n\nStep 4: Merging replacement parts...");
    const merged = await mergeReplacementParts(client);
    console.log(`  Merged ${merged} replacement parts.\n`);

    // Summary
    console.log("\nRe-scrape Complete!");
    console.log("===================");
    console.log(`  Subgroups processed: ${pagesProcessed}`);
    console.log(`  New parts inserted: ${totalParts}`);

  } finally {
    await closeClient();
  }
}

async function getSubgroupUrls(client: Client): Promise<string[]> {
  // Build URL pattern from env vars
  const frameName = Deno.env.get("FRAME_NAME") || "pd6w";
  const trimCode = Deno.env.get("TRIM_CODE") || "hseue9";
  const urlPattern = `%/delica_space_gear/${frameName}/${trimCode}/%`;

  const result = await client.execute({
    sql: `
      SELECT url FROM scrape_progress
      WHERE status = 'completed'
      AND url LIKE ?
    `,
    args: [urlPattern],
  });

  return result.rows
    .map((row) => row.url as string)
    .filter((url) => {
      const pathParts = new URL(url).pathname.split("/").filter(Boolean);
      // Subgroup pages have: delica_space_gear/{frame}/{trim}/group/subgroup (5 parts)
      return pathParts.length === 5;
    });
}

function shortenUrl(url: string): string {
  return url.replace(DEFAULT_CONFIG.baseUrl, "/");
}

main();
