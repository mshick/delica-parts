import type { Client } from "@libsql/client";
import type { ScraperConfig, Part, Diagram } from "../types.ts";
import { RateLimitedFetcher } from "./fetcher.ts";
import { cleanSubgroupName } from "../utils.ts";
import {
  parseIndexPage,
  parseCategoryPage,
  hasPartsTable,
  parsePartsPage,
  extractPageTitle,
  isSubcategoryListing,
  parseDetailListSections,
} from "./parser.ts";
import {
  insertGroup,
  insertSubgroup,
  insertDiagram,
  insertParts,
  updateDiagramImagePath,
  markUrlPending,
  markUrlCompleted,
  markUrlFailed,
  getUrlStatus,
  getPendingUrls,
  getDiagramsWithoutImages,
  mergeReplacementParts,
} from "../db/queries.ts";

export class Scraper {
  private client: Client;
  private config: ScraperConfig;
  private fetcher: RateLimitedFetcher;
  private urlQueue: string[] = [];
  private processedCount = 0;

  // Maps detail_page_id to pre-created diagram and subgroup IDs
  private diagramGroupMap: Map<string, { diagramId: string; subgroupId: string }> = new Map();

  constructor(client: Client, config: ScraperConfig) {
    this.client = client;
    this.config = config;
    this.fetcher = new RateLimitedFetcher(config);
  }

  private getUrlWithFrame(url: string): string {
    const urlObj = new URL(url);
    urlObj.searchParams.set("frame_no", this.config.frameNumber);
    return urlObj.toString();
  }

  async run(): Promise<void> {
    console.log("Starting Delica Parts Scraper");
    console.log(`Base URL: ${this.config.baseUrl}`);
    console.log(`Frame Number: ${this.config.frameNumber}`);
    console.log("");

    // Check for pending URLs from previous run
    const pendingUrls = await getPendingUrls(this.client);
    if (pendingUrls.length > 0) {
      console.log(`Resuming with ${pendingUrls.length} pending URLs`);
      this.urlQueue = [...pendingUrls];
    } else {
      // Start fresh from index page
      await this.scrapeIndex();
    }

    // Process all pending URLs
    await this.processQueue();

    // Merge replacement part rows
    await this.mergeReplacementParts();

    // Download images
    await this.downloadImages();

    console.log("\nScraping complete!");
  }

  private async scrapeIndex(): Promise<void> {
    const indexUrl = this.getUrlWithFrame(this.config.baseUrl);
    console.log(`Fetching index page: ${indexUrl}`);

    const status = await getUrlStatus(this.client, indexUrl);
    if (status?.status === "completed") {
      console.log("Index page already scraped");
      // Still load pending URLs
      this.urlQueue = await getPendingUrls(this.client);
      return;
    }

    await markUrlPending(this.client, indexUrl);

    const result = await this.fetcher.fetch(indexUrl);
    if (!result.ok) {
      console.error(`Failed to fetch index: ${result.error}`);
      await markUrlFailed(this.client, indexUrl, result.error || "Unknown error");
      return;
    }

    const categories = parseIndexPage(result.html!, indexUrl);
    console.log(`Found ${categories.length} categories`);

    // Include all categories - we want comprehensive parts data
    const filteredCategories = categories;
    console.log(`Found ${filteredCategories.length} categories: ${filteredCategories.map(c => c.id).join(", ")}`);

    // Save groups and queue them for scraping
    for (const cat of filteredCategories) {
      await insertGroup(this.client, {
        id: cat.id,
        name: cat.name,
      });
      const catUrl = this.getUrlWithFrame(cat.url);
      await markUrlPending(this.client, catUrl);
      this.urlQueue.push(catUrl);
    }

    await markUrlCompleted(this.client, indexUrl);
  }

  private async processQueue(): Promise<void> {
    while (this.urlQueue.length > 0) {
      const url = this.urlQueue.shift()!;

      // Check if already completed
      const status = await getUrlStatus(this.client, url);
      if (status?.status === "completed") {
        continue;
      }

      this.processedCount++;
      const queueSize = this.urlQueue.length;
      console.log(`[${this.processedCount}] Processing (${queueSize} queued): ${this.shortenUrl(url)}`);

      const result = await this.fetcher.fetch(url);
      if (!result.ok) {
        console.error(`  Failed: ${result.error}`);
        await markUrlFailed(this.client, url, result.error || "Unknown error");
        continue;
      }

      await this.processPage(url, result.html!);
      await markUrlCompleted(this.client, url);
    }
  }

  private shortenUrl(url: string): string {
    // Remove the base path for cleaner logging
    return url.replace(this.config.baseUrl, "/");
  }

  private async processPage(url: string, html: string): Promise<void> {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    // pathParts: ["delica_space_gear", "pd6w", "hseue9", "group", "subgroup", "detail_id"]

    // Check if this is a subgroup listing page and store it
    if (isSubcategoryListing(html, url)) {
      await this.processSubgroupPage(url, html, pathParts);
    }

    // Check if this page has a parts table (detail page)
    if (hasPartsTable(html)) {
      await this.processPartsPage(url, html, pathParts);
    }

    // Extract and queue new links
    const links = parseCategoryPage(html, url);
    let newLinks = 0;

    for (const link of links) {
      const linkWithFrame = this.getUrlWithFrame(link);
      const status = await getUrlStatus(this.client, linkWithFrame);
      if (!status) {
        await markUrlPending(this.client, linkWithFrame);
        this.urlQueue.push(linkWithFrame);
        newLinks++;
      }
    }

    if (newLinks > 0) {
      console.log(`  Found ${newLinks} new links to process`);
    }
  }

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
    const rawTitle = extractPageTitle(html) || subgroupSlug.replace(/-/g, " ");
    const pageTitle = cleanSubgroupName(rawTitle);

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
        const cleanedHeading = cleanSubgroupName(section.heading);
        const subgroupName = `${pageTitle} - ${cleanedHeading}`;

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
          name: cleanedHeading,
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
        const rawName = extractPageTitle(html) || subgroupSlug.replace(/-/g, " ");
        const subgroupName = cleanSubgroupName(rawName);
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

  private async mergeReplacementParts(): Promise<void> {
    console.log("\nMerging replacement part rows...");
    const merged = await mergeReplacementParts(this.client);
    if (merged > 0) {
      console.log(`  Merged ${merged} replacement parts into preceding rows`);
    } else {
      console.log("  No replacement parts to merge");
    }
  }

  async downloadImages(): Promise<void> {
    const diagrams = await getDiagramsWithoutImages(this.client);

    if (diagrams.length === 0) {
      console.log("No images to download");
      return;
    }

    console.log(`\nDownloading ${diagrams.length} images...`);

    // Ensure images directory exists
    try {
      await Deno.mkdir(this.config.imagesDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    let downloaded = 0;
    let failed = 0;

    for (const diagram of diagrams) {
      if (!diagram.image_url) continue;

      // Clean up the diagram ID for filename
      const safeId = diagram.id.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 100);
      const filename = `${safeId}.${this.getExtension(diagram.image_url)}`;
      const imagePath = `${this.config.imagesDir}/${filename}`;

      console.log(`  Downloading: ${filename}`);

      const result = await this.fetcher.fetchImage(diagram.image_url);

      if (result.ok && result.data) {
        try {
          await Deno.writeFile(imagePath, result.data);
          await updateDiagramImagePath(this.client, diagram.id, imagePath);
          downloaded++;
        } catch (error) {
          console.error(`    Failed to save: ${error}`);
          failed++;
        }
      } else {
        console.error(`    Failed to download: ${result.error}`);
        failed++;
      }
    }

    console.log(`\nImages downloaded: ${downloaded}, failed: ${failed}`);
  }

  private getExtension(url: string): string {
    const match = url.match(/\.([a-z]+)(?:\?|$)/i);
    return match ? match[1].toLowerCase() : "png";
  }
}
