import type { Client } from "@libsql/client";
import type {
  Group,
  Subgroup,
  Diagram,
  Part,
  ScrapeProgress,
} from "../types.ts";

// Group operations
export async function insertGroup(
  client: Client,
  group: Group
): Promise<void> {
  await client.execute({
    sql: `INSERT OR IGNORE INTO groups (id, name) VALUES (?, ?)`,
    args: [group.id, group.name],
  });
}

export async function getGroup(
  client: Client,
  id: string
): Promise<Group | null> {
  const result = await client.execute({
    sql: `SELECT * FROM groups WHERE id = ?`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
  };
}

// Subgroup operations
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

// Diagram operations
export async function insertDiagram(
  client: Client,
  diagram: Diagram
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO diagrams (id, group_id, subgroup_id, name, image_url, image_path, source_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      diagram.id,
      diagram.group_id,
      diagram.subgroup_id,
      diagram.name,
      diagram.image_url,
      diagram.image_path,
      diagram.source_url,
    ],
  });
}

export async function updateDiagramImagePath(
  client: Client,
  diagramId: string,
  imagePath: string
): Promise<void> {
  await client.execute({
    sql: `UPDATE diagrams SET image_path = ? WHERE id = ?`,
    args: [imagePath, diagramId],
  });
}

export async function getDiagramsWithoutImages(
  client: Client
): Promise<Diagram[]> {
  const result = await client.execute(
    `SELECT * FROM diagrams WHERE image_url IS NOT NULL AND image_path IS NULL`
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    group_id: row.group_id as string,
    subgroup_id: row.subgroup_id as string | null,
    name: row.name as string,
    image_url: row.image_url as string | null,
    image_path: row.image_path as string | null,
    source_url: row.source_url as string,
  }));
}

// Part operations
export async function insertPart(client: Client, part: Part): Promise<void> {
  await client.execute({
    sql: `INSERT OR IGNORE INTO parts (detail_page_id, part_number, pnc, description, ref_number, quantity, spec, notes, color, model_date_range, diagram_id, group_id, subgroup_id, replacement_part_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      part.detail_page_id,
      part.part_number,
      part.pnc,
      part.description,
      part.ref_number,
      part.quantity,
      part.spec,
      part.notes,
      part.color,
      part.model_date_range,
      part.diagram_id,
      part.group_id,
      part.subgroup_id ?? null,
      part.replacement_part_number ?? null,
    ],
  });
}

export async function insertParts(
  client: Client,
  parts: Part[]
): Promise<void> {
  if (parts.length === 0) return;

  const batch = parts.map((part) => ({
    sql: `INSERT OR IGNORE INTO parts (detail_page_id, part_number, pnc, description, ref_number, quantity, spec, notes, color, model_date_range, diagram_id, group_id, subgroup_id, replacement_part_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      part.detail_page_id,
      part.part_number,
      part.pnc,
      part.description,
      part.ref_number,
      part.quantity,
      part.spec,
      part.notes,
      part.color,
      part.model_date_range,
      part.diagram_id,
      part.group_id,
      part.subgroup_id ?? null,
      part.replacement_part_number ?? null,
    ],
  }));

  await client.batch(batch);
}

export async function searchParts(
  client: Client,
  query: string
): Promise<Part[]> {
  const result = await client.execute({
    sql: `SELECT p.* FROM parts p
          JOIN parts_fts fts ON p.id = fts.rowid
          WHERE parts_fts MATCH ?
          ORDER BY rank`,
    args: [query],
  });
  return result.rows.map((row) => ({
    id: row.id as number,
    detail_page_id: row.detail_page_id as string | null,
    part_number: row.part_number as string,
    pnc: row.pnc as string | null,
    description: row.description as string | null,
    ref_number: row.ref_number as string | null,
    quantity: row.quantity as number | null,
    spec: row.spec as string | null,
    notes: row.notes as string | null,
    color: row.color as string | null,
    model_date_range: row.model_date_range as string | null,
    diagram_id: row.diagram_id as string,
    group_id: row.group_id as string,
    subgroup_id: row.subgroup_id as string | null,
    replacement_part_number: row.replacement_part_number as string | null,
  }));
}

// Scrape progress operations
export async function markUrlPending(
  client: Client,
  url: string
): Promise<void> {
  await client.execute({
    sql: `INSERT OR IGNORE INTO scrape_progress (url, status) VALUES (?, 'pending')`,
    args: [url],
  });
}

export async function markUrlCompleted(
  client: Client,
  url: string
): Promise<void> {
  await client.execute({
    sql: `UPDATE scrape_progress SET status = 'completed', scraped_at = datetime('now'), error = NULL WHERE url = ?`,
    args: [url],
  });
}

export async function markUrlFailed(
  client: Client,
  url: string,
  error: string
): Promise<void> {
  await client.execute({
    sql: `UPDATE scrape_progress SET status = 'failed', scraped_at = datetime('now'), error = ? WHERE url = ?`,
    args: [error, url],
  });
}

export async function getUrlStatus(
  client: Client,
  url: string
): Promise<ScrapeProgress | null> {
  const result = await client.execute({
    sql: `SELECT * FROM scrape_progress WHERE url = ?`,
    args: [url],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    url: row.url as string,
    status: row.status as ScrapeProgress["status"],
    scraped_at: row.scraped_at as string | null,
    error: row.error as string | null,
  };
}

export async function getPendingUrls(client: Client): Promise<string[]> {
  const result = await client.execute(
    `SELECT url FROM scrape_progress WHERE status = 'pending'`
  );
  return result.rows.map((row) => row.url as string);
}

export async function getFailedUrls(client: Client): Promise<string[]> {
  const result = await client.execute(
    `SELECT url FROM scrape_progress WHERE status = 'failed'`
  );
  return result.rows.map((row) => row.url as string);
}

export async function resetFailedUrls(client: Client): Promise<number> {
  const result = await client.execute(
    `UPDATE scrape_progress SET status = 'pending', error = NULL WHERE status = 'failed'`
  );
  return result.rowsAffected;
}

// Statistics
export interface ScrapeStats {
  totalUrls: number;
  completedUrls: number;
  failedUrls: number;
  pendingUrls: number;
  totalGroups: number;
  totalSubgroups: number;
  totalDiagrams: number;
  totalParts: number;
  imagesDownloaded: number;
}

export async function getStats(client: Client): Promise<ScrapeStats> {
  const [progress, groups, subgroups, diagrams, parts, images] = await Promise.all([
    client.execute(`
      SELECT status, COUNT(*) as count FROM scrape_progress GROUP BY status
    `),
    client.execute(`SELECT COUNT(*) as count FROM groups`),
    client.execute(`SELECT COUNT(*) as count FROM subgroups`),
    client.execute(`SELECT COUNT(*) as count FROM diagrams`),
    client.execute(`SELECT COUNT(*) as count FROM parts`),
    client.execute(
      `SELECT COUNT(*) as count FROM diagrams WHERE image_path IS NOT NULL`
    ),
  ]);

  const progressMap: Record<string, number> = {};
  for (const row of progress.rows) {
    progressMap[row.status as string] = row.count as number;
  }

  return {
    totalUrls:
      (progressMap.completed || 0) +
      (progressMap.failed || 0) +
      (progressMap.pending || 0),
    completedUrls: progressMap.completed || 0,
    failedUrls: progressMap.failed || 0,
    pendingUrls: progressMap.pending || 0,
    totalGroups: groups.rows[0].count as number,
    totalSubgroups: subgroups.rows[0].count as number,
    totalDiagrams: diagrams.rows[0].count as number,
    totalParts: parts.rows[0].count as number,
    imagesDownloaded: images.rows[0].count as number,
  };
}

// Merge replacement part rows into preceding parts
// Replacement parts are identified as rows with part_number but no pnc, description, or ref_number
export async function mergeReplacementParts(client: Client): Promise<number> {
  // Find all replacement part rows (ordered by id to process in sequence)
  const replacements = await client.execute(`
    SELECT id, part_number
    FROM parts
    WHERE pnc IS NULL AND description IS NULL AND ref_number IS NULL
    ORDER BY id
  `);

  if (replacements.rows.length === 0) {
    return 0;
  }

  let merged = 0;

  for (const row of replacements.rows) {
    const replacementId = row.id as number;
    const replacementPartNumber = row.part_number as string;

    // Find the preceding part (the row with id just before this one)
    const preceding = await client.execute({
      sql: `
        SELECT id FROM parts
        WHERE id < ? AND pnc IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `,
      args: [replacementId],
    });

    if (preceding.rows.length > 0) {
      const precedingId = preceding.rows[0].id as number;

      // Update the preceding part with the replacement part number
      await client.execute({
        sql: `UPDATE parts SET replacement_part_number = ? WHERE id = ?`,
        args: [replacementPartNumber, precedingId],
      });

      // Delete the replacement row
      await client.execute({
        sql: `DELETE FROM parts WHERE id = ?`,
        args: [replacementId],
      });

      merged++;
    }
  }

  return merged;
}

// Generic query execution for CLI
export async function executeQuery(
  client: Client,
  sql: string
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const result = await client.execute(sql);
  const columns = result.columns;
  const rows = result.rows.map((row) =>
    columns.map((col) => row[col])
  );
  return { columns, rows };
}
