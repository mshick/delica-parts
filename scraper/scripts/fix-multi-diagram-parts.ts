/**
 * Fix parts that appear in multiple diagrams on the same subgroup page.
 *
 * This script:
 * 1. Finds subgroups with multiple diagrams
 * 2. Re-fetches the subgroup page to find shared detail page IDs
 * 3. Inserts missing part records for parts that should appear in multiple diagrams
 */

import { getClient, closeClient } from "../src/db/client.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { RateLimitedFetcher } from "../src/scraper/fetcher.ts";
import * as cheerio from "cheerio";

interface DiagramMapping {
  diagramId: string;
  subgroupId: string;
  detailPageIds: string[];
}

// Use the same rate-limited fetcher as the main scraper
const fetcher = new RateLimitedFetcher(DEFAULT_CONFIG);

async function fetchPage(url: string): Promise<string> {
  const result = await fetcher.fetch(url);
  if (!result.ok || !result.html) {
    throw new Error(`Failed to fetch ${url}: ${result.error || result.status}`);
  }
  return result.html;
}

function parseDetailListSections(html: string): DiagramMapping[] {
  const $ = cheerio.load(html);
  const sections: DiagramMapping[] = [];

  $("td.detail-list").each((_, td) => {
    const $td = $(td);
    const heading = $td.find("h4").first().text().trim();
    if (!heading) return;

    // Create slug from heading
    const slug = heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50);

    // Extract detail page IDs
    const detailPageIdSet = new Set<string>();
    $td.find("a, area").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/\/(\d+(?:,\d+)*)\/?(?:\?|$)/);
      if (match) {
        detailPageIdSet.add(match[1]);
      }
    });

    sections.push({
      diagramId: "", // Will be set later
      subgroupId: "", // Will be set later
      detailPageIds: Array.from(detailPageIdSet),
    });
  });

  return sections;
}

async function main() {
  const client = getClient(DEFAULT_CONFIG.dbPath);

  console.log("Finding subgroup paths with multiple diagrams...\n");

  // Find all subgroup PATHS that have multiple diagrams
  // (Each diagram has its own subgroup record, but they share the same path)
  const result = await client.execute(`
    SELECT s.path, s.group_id, COUNT(DISTINCT d.id) as diagram_count
    FROM subgroups s
    JOIN diagrams d ON d.subgroup_id = s.id
    GROUP BY s.path
    HAVING diagram_count > 1
  `);

  const subgroupsWithMultipleDiagrams = result.rows.map(row => ({
    subgroupId: "", // Not used directly
    path: row.path as string,
    groupId: row.group_id as string,
    diagramCount: row.diagram_count as number,
  }));

  console.log(`Found ${subgroupsWithMultipleDiagrams.length} subgroups with multiple diagrams\n`);

  let totalFixed = 0;

  for (const subgroup of subgroupsWithMultipleDiagrams) {
    // Get the diagrams for this subgroup
    const diagramsResult = await client.execute({
      sql: `SELECT id, name FROM diagrams WHERE subgroup_id LIKE ? || '%' ORDER BY id`,
      args: [subgroup.path],
    });

    const diagrams = diagramsResult.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
    }));

    // Construct the subgroup URL
    const frameName = Deno.env.get("FRAME_NAME") || "pd6w";
    const trimCode = Deno.env.get("TRIM_CODE") || "hseue9";
    const frameNo = Deno.env.get("FRAME_NO") || "PD6W-0500904";
    const url = `https://mitsubishi.epc-data.com/delica_space_gear/${frameName}/${trimCode}/${subgroup.path}/?frame_no=${frameNo}`;

    console.log(`\nProcessing: ${subgroup.path}`);
    console.log(`  URL: ${url}`);
    console.log(`  Diagrams: ${diagrams.map(d => d.name).join(", ")}`);

    try {
      // Fetch and parse the page
      const html = await fetchPage(url);
      const sections = parseDetailListSections(html);

      if (sections.length !== diagrams.length) {
        console.log(`  WARNING: Page has ${sections.length} sections but DB has ${diagrams.length} diagrams`);
        continue;
      }

      // Match sections to diagrams by order
      for (let i = 0; i < sections.length; i++) {
        sections[i].diagramId = diagrams[i].id;
        sections[i].subgroupId = diagrams[i].id; // In this schema, subgroupId === diagramId
      }

      // Find detail page IDs that appear in multiple sections
      const detailIdToDiagrams = new Map<string, string[]>();
      for (const section of sections) {
        for (const detailId of section.detailPageIds) {
          const existing = detailIdToDiagrams.get(detailId) || [];
          existing.push(section.diagramId);
          detailIdToDiagrams.set(detailId, existing);
        }
      }

      // Find shared detail IDs
      const sharedDetailIds = Array.from(detailIdToDiagrams.entries())
        .filter(([_, diagrams]) => diagrams.length > 1);

      if (sharedDetailIds.length === 0) {
        console.log(`  No shared detail pages found`);
        continue;
      }

      console.log(`  Found ${sharedDetailIds.length} detail pages shared between diagrams`);

      // For each shared detail ID, check if parts exist in all diagrams
      for (const [detailId, diagramIds] of sharedDetailIds) {
        // Get parts for this detail page
        const partsResult = await client.execute({
          sql: `SELECT * FROM parts WHERE detail_page_id = ?`,
          args: [detailId],
        });

        if (partsResult.rows.length === 0) {
          console.log(`    No parts found for detail page ${detailId}`);
          continue;
        }

        // Check which diagrams are missing these parts
        const existingDiagrams = new Set(partsResult.rows.map(r => r.diagram_id as string));
        const missingDiagrams = diagramIds.filter(d => !existingDiagrams.has(d));

        if (missingDiagrams.length === 0) {
          continue;
        }

        console.log(`    Detail page ${detailId}: adding parts to ${missingDiagrams.length} more diagram(s)`);

        // Insert parts for missing diagrams
        for (const diagramId of missingDiagrams) {
          for (const partRow of partsResult.rows) {
            await client.execute({
              sql: `INSERT OR IGNORE INTO parts
                    (detail_page_id, part_number, pnc, description, ref_number, quantity, spec, notes, color, model_date_range, diagram_id, group_id, subgroup_id, replacement_part_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                partRow.detail_page_id,
                partRow.part_number,
                partRow.pnc,
                partRow.description,
                partRow.ref_number,
                partRow.quantity,
                partRow.spec,
                partRow.notes,
                partRow.color,
                partRow.model_date_range,
                diagramId,
                partRow.group_id,
                diagramId, // subgroup_id matches diagram_id in this schema
                partRow.replacement_part_number,
              ],
            });
            totalFixed++;
          }
        }
      }

      // The RateLimitedFetcher handles delays between requests

    } catch (error) {
      console.log(`  ERROR: ${error}`);
    }
  }

  console.log(`\nDone! Added ${totalFixed} part records.`);

  await closeClient();
}

main();
