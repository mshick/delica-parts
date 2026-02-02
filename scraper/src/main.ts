import { load as loadEnv } from "@std/dotenv";

// Load .env file from project root before importing config
await loadEnv({ envPath: "../.env", export: true });

import { getClient, closeClient } from "./db/client.ts";
import { createSchema, runMigrations } from "./db/schema.ts";
import {
  getStats,
  executeQuery,
  resetFailedUrls,
  getFailedUrls,
} from "./db/queries.ts";
import { Scraper } from "./scraper/index.ts";
import { DEFAULT_CONFIG } from "./types.ts";

async function ensureDataDir(): Promise<void> {
  try {
    await Deno.mkdir(DEFAULT_CONFIG.dataDir, { recursive: true });
    await Deno.mkdir(DEFAULT_CONFIG.imagesDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

async function initializeDatabase(): Promise<ReturnType<typeof getClient>> {
  await ensureDataDir();
  const client = getClient(DEFAULT_CONFIG.dbPath);
  await createSchema(client);
  return client;
}

async function scrapeCommand(): Promise<void> {
  console.log("Delica Parts Scraper");
  console.log("====================\n");

  const client = await initializeDatabase();

  try {
    const scraper = new Scraper(client, DEFAULT_CONFIG);
    await scraper.run();
  } finally {
    await closeClient();
  }
}

async function statusCommand(): Promise<void> {
  const client = await initializeDatabase();

  try {
    const stats = await getStats(client);

    console.log("Delica Parts Scraper - Status");
    console.log("============================\n");
    console.log("Scrape Progress:");
    console.log(`  Total URLs:     ${stats.totalUrls}`);
    console.log(`  Completed:      ${stats.completedUrls}`);
    console.log(`  Failed:         ${stats.failedUrls}`);
    console.log(`  Pending:        ${stats.pendingUrls}`);
    console.log("");
    console.log("Database Contents:");
    console.log(`  Groups:         ${stats.totalGroups}`);
    console.log(`  Subgroups:      ${stats.totalSubgroups}`);
    console.log(`  Diagrams:       ${stats.totalDiagrams}`);
    console.log(`  Parts:          ${stats.totalParts}`);
    console.log(`  Images:         ${stats.imagesDownloaded}`);

    if (stats.failedUrls > 0) {
      console.log("\nFailed URLs:");
      const failedUrls = await getFailedUrls(client);
      for (const url of failedUrls.slice(0, 10)) {
        console.log(`  - ${url}`);
      }
      if (failedUrls.length > 10) {
        console.log(`  ... and ${failedUrls.length - 10} more`);
      }
    }
  } finally {
    await closeClient();
  }
}

async function retryCommand(): Promise<void> {
  const client = await initializeDatabase();

  try {
    const count = await resetFailedUrls(client);
    console.log(`Reset ${count} failed URLs to pending`);

    if (count > 0) {
      console.log("Starting scraper to retry...\n");
      const scraper = new Scraper(client, DEFAULT_CONFIG);
      await scraper.run();
    }
  } finally {
    await closeClient();
  }
}

async function migrateCommand(): Promise<void> {
  console.log("Delica Parts Scraper - Running Migrations");
  console.log("=========================================\n");

  const client = await initializeDatabase();

  try {
    await runMigrations(client);
    console.log("\nMigrations complete!");
  } finally {
    await closeClient();
  }
}

async function queryCommand(sql: string): Promise<void> {
  const client = await initializeDatabase();

  try {
    const result = await executeQuery(client, sql);

    // Print column headers
    console.log(result.columns.join("\t"));
    console.log("-".repeat(result.columns.length * 15));

    // Print rows
    for (const row of result.rows) {
      console.log(row.map((v) => (v === null ? "NULL" : String(v))).join("\t"));
    }

    console.log(`\n(${result.rows.length} rows)`);
  } catch (error) {
    console.error("Query error:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  } finally {
    await closeClient();
  }
}

function printUsage(): void {
  console.log(`
Delica Parts Scraper - CLI

Usage:
  deno task scrape              Start or resume scraping
  deno task status              Show scraping progress and statistics
  deno task retry               Retry failed URLs
  deno task migrate             Run database migrations
  deno task query "<SQL>"       Execute a SQL query

Examples:
  deno task scrape
  deno task status
  deno task retry
  deno task query "SELECT COUNT(*) FROM parts"
  deno task query "SELECT * FROM parts WHERE part_number LIKE 'MB%' LIMIT 10"
  deno task query "SELECT * FROM parts_fts WHERE parts_fts MATCH 'engine'"
`);
}

// Main entry point
const command = Deno.args[0];

switch (command) {
  case "scrape":
    await scrapeCommand();
    break;
  case "status":
    await statusCommand();
    break;
  case "retry":
    await retryCommand();
    break;
  case "migrate":
    await migrateCommand();
    break;
  case "query":
    if (Deno.args.length < 2) {
      console.error("Error: Missing SQL query argument");
      console.error("Usage: deno task query \"<SQL>\"");
      Deno.exit(1);
    }
    await queryCommand(Deno.args.slice(1).join(" "));
    break;
  default:
    printUsage();
    if (command && command !== "help" && command !== "--help" && command !== "-h") {
      console.error(`\nUnknown command: ${command}`);
      Deno.exit(1);
    }
}
