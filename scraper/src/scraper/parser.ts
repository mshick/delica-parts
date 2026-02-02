import * as cheerio from "cheerio";
import { slugify } from "../utils.ts";
import type {
  ParsedGroup,
  ParsedDiagramPage,
  ParsedPart,
} from "../types.ts";

// Build URL path pattern from environment variables
function getVehicleUrlPattern(): string {
  const frameName = Deno.env.get("FRAME_NAME") || "pd6w";
  const trimCode = Deno.env.get("TRIM_CODE") || "hseue9";
  return `/delica_space_gear/${frameName}/${trimCode}/`;
}

export interface DetailListSection {
  heading: string;        // h4 text
  slug: string;           // slugified heading for ID suffix
  imageUrl: string | null;
  detailPageIds: string[]; // numeric IDs from detail page links
}

/**
 * Parse the main index page to extract category links.
 * Categories are in #partnames list like: "11 - <a href="...">Engine</a>"
 */
export function parseIndexPage(html: string, baseUrl: string): ParsedGroup[] {
  const $ = cheerio.load(html);
  const categories: ParsedGroup[] = [];
  const seen = new Set<string>();

  // Categories are in <ul id="partnames"> with format:
  // <li>11 - <a href="/delica_space_gear/pd6w/hseue9/engine/">Engine</a></li>
  $("#partnames li").each((_, element) => {
    const $li = $(element);
    const $a = $li.find("a").first();
    const href = $a.attr("href");
    const linkText = $a.text().trim();
    const fullText = $li.text().trim();

    if (!href || !linkText) return;

    // Extract numeric category code from the li text (e.g., "11 - Engine" -> "11")
    const codeMatch = fullText.match(/^(\d{2})\s*-/);
    if (!codeMatch) return;

    const code = codeMatch[1];

    // Extract the URL slug as the ID (e.g., "/engine/" -> "engine")
    // This ensures consistency with URL-based category lookups
    const urlObj = new URL(href, baseUrl);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    // pathParts: ["delica_space_gear", "pd6w", "hseue9", "engine"]
    const slug = pathParts[3];
    if (!slug) return;

    // Skip duplicates (the page has some)
    if (seen.has(slug)) return;
    seen.add(slug);

    // Build absolute URL
    const absoluteUrl = urlObj.toString();

    categories.push({
      id: slug, // Use URL slug as ID for consistency
      name: `${code} - ${linkText}`,
      url: absoluteUrl,
    });
  });

  return categories;
}

/**
 * Extract links from a category page.
 * Category pages have subcategory links in div elements with thumbnail images.
 */
export function parseCategoryPage(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seen = new Set<string>();

  // Links are in div elements like:
  // <div><a href="/delica_space_gear/pd6w/hseue9/engine/engine-assy/">
  // <img .../>Engine assy</a></div>
  $("a").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const vehiclePattern = getVehicleUrlPattern();

    // Skip navigation links
    if (
      href === "/" ||
      href === "../" ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.includes("amayama.com") ||
      href.includes("epc-data.com") && !href.includes(vehiclePattern)
    ) {
      return;
    }

    // Only follow links within our complectation
    if (!href.includes(vehiclePattern)) {
      return;
    }

    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      // Remove any trailing hash
      const cleanUrl = absoluteUrl.split("#")[0];
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        links.push(cleanUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  // Also look for image map areas (diagram pages have these)
  const areaPattern = getVehicleUrlPattern();
  $("area").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    if (!href.includes(areaPattern)) {
      return;
    }

    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      const cleanUrl = absoluteUrl.split("#")[0];
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        links.push(cleanUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return links;
}

/**
 * Check if a page has a parts table.
 */
export function hasPartsTable(html: string): boolean {
  const $ = cheerio.load(html);
  // The actual part details are in table.top_cars
  return $("table.top_cars").length > 0;
}

/**
 * Extract the page title/heading for use as category/subcategory name.
 */
export function extractPageTitle(html: string): string | null {
  const $ = cheerio.load(html);

  // Try h1 first
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;

  // Try title tag, often formatted as "Page Name for Vehicle..."
  const title = $("title").text().trim();
  if (title) {
    const match = title.match(/^(.+?)\s+for\s+/i);
    if (match) return match[1].trim();
    return title.split(" - ")[0].trim();
  }

  return null;
}

/**
 * Check if a page is a subcategory listing (has links to detail pages but no parts table).
 */
export function isSubcategoryListing(html: string, url: string): boolean {
  if (hasPartsTable(html)) return false;

  const $ = cheerio.load(html);
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  // Subcategory pages are at depth 5 (vehicle/model/complect/category/subcategory/)
  // e.g., /delica_space_gear/pd6w/hseue9/lubrication/oil-pump-oil-filter/
  if (pathParts.length < 5) return false;

  // Check if page has links to deeper pages (detail pages)
  let hasDetailLinks = false;
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.includes(pathParts[4]) && href.match(/\/\d+(?:,\d+)*\/?(\?|$)/)) {
      hasDetailLinks = true;
      return false; // break
    }
  });

  return hasDetailLinks;
}

export interface DiagramGroupInfo {
  heading: string;
  imageUrl: string | null;
  detailPageIds: string[];
}

/**
 * Parse diagram groups from a subcategory listing page.
 * These pages often have multiple diagrams with headings like "ALL (LEFT SIDE)", "ALL (RIGHT SIDE)".
 * Each diagram section contains links to detail pages for PNCs shown on that diagram.
 */
export function parseDiagramGroups(html: string, baseUrl: string): DiagramGroupInfo[] {
  const $ = cheerio.load(html);
  const groups: DiagramGroupInfo[] = [];

  // Look for diagram sections - typically structured with headings and images
  // Common patterns: h2/h3 headings, or text before diagram images

  // Strategy: Find all diagram images and look for nearby heading text
  // deno-lint-ignore no-explicit-any
  const diagramImageElements: any[] = [];

  $("img.parts_picture, img[src*='diagram'], img[src*='scheme']").each((_, img) => {
    diagramImageElements.push(img);
  });

  if (diagramImageElements.length === 0) {
    // Fallback: look for any images that might be diagrams
    $("img").each((_, img) => {
      const src = $(img).attr("src") || "";
      if (src.includes("parts") || src.includes("diagram") || src.includes("scheme") || src.match(/\/\d+\.(png|jpg|gif)/i)) {
        diagramImageElements.push(img);
      }
    });
  }

  // Track which detail page IDs we've seen to avoid duplicates
  const seenDetailIds = new Set<string>();

  diagramImageElements.forEach((img, index) => {
    const $img = $(img);
    const imageUrl = $img.attr("src");
    const absoluteImageUrl = imageUrl ? (imageUrl.startsWith("http") ? imageUrl : new URL(imageUrl, baseUrl).toString()) : null;

    // Look for heading text near this image
    // Check previous siblings, parent's previous siblings, or containing elements
    let heading = "";

    // Check for heading in parent or ancestor elements
    const $parent = $img.parent();
    const $grandparent = $parent.parent();

    // Look for text before the image in the same container
    const prevText = $parent.prevAll("h2, h3, h4, strong, b, .heading, .title").first().text().trim();
    if (prevText) {
      heading = prevText;
    } else {
      // Check grandparent level
      const gpPrevText = $grandparent.prevAll("h2, h3, h4, strong, b, .heading, .title").first().text().trim();
      if (gpPrevText) {
        heading = gpPrevText;
      }
    }

    // Also check for text containing common patterns like "ALL", "LEFT", "RIGHT", etc.
    if (!heading) {
      $parent.parents().each((_, el) => {
        const $el = $(el);
        const text = $el.find("h2, h3, h4, strong, b").first().text().trim();
        if (text && (text.includes("ALL") || text.includes("LEFT") || text.includes("RIGHT") || text.match(/схема|diagram|scheme/i))) {
          heading = text;
          return false; // break
        }
      });
    }

    // Extract heading from text patterns like "Схема 1 (ALL (LEFT SIDE))"
    const headingMatch = heading.match(/\(([^)]+)\)\s*$/);
    if (headingMatch) {
      heading = headingMatch[1];
    }

    // If still no heading, use a default based on index
    if (!heading) {
      heading = `Diagram ${index + 1}`;
    }

    // Find detail page links associated with this diagram
    // They're typically in the same container or following the image
    const detailPageIds: string[] = [];

    // Look in the same container and following siblings
    const $container = $img.closest("div, section, article, td");
    $container.find("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const match = href.match(/\/(\d+(?:,\d+)*)\/?(?:\?|$)/);
      if (match && !seenDetailIds.has(match[1])) {
        detailPageIds.push(match[1]);
        seenDetailIds.add(match[1]);
      }
    });

    // If no links found in container, look at following siblings until next image
    if (detailPageIds.length === 0) {
      let $current = $img.parent().next();
      while ($current.length > 0 && $current.find("img.parts_picture, img[src*='diagram']").length === 0) {
        $current.find("a").each((_, a) => {
          const href = $(a).attr("href") || "";
          const match = href.match(/\/(\d+(?:,\d+)*)\/?(?:\?|$)/);
          if (match && !seenDetailIds.has(match[1])) {
            detailPageIds.push(match[1]);
            seenDetailIds.add(match[1]);
          }
        });
        $current = $current.next();
      }
    }

    if (absoluteImageUrl || detailPageIds.length > 0) {
      groups.push({
        heading,
        imageUrl: absoluteImageUrl,
        detailPageIds,
      });
    }
  });

  // If no diagram images found but there are detail links, create a single default group
  if (groups.length === 0) {
    const defaultGroup: DiagramGroupInfo = {
      heading: "Main",
      imageUrl: null,
      detailPageIds: [],
    };

    $("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const match = href.match(/\/(\d+(?:,\d+)*)\/?(?:\?|$)/);
      if (match && !seenDetailIds.has(match[1])) {
        defaultGroup.detailPageIds.push(match[1]);
        seenDetailIds.add(match[1]);
      }
    });

    if (defaultGroup.detailPageIds.length > 0) {
      groups.push(defaultGroup);
    }
  }

  return groups;
}

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

    // Extract detail page IDs from links (supports comma-separated IDs like 723107,723115)
    const detailPageIds: string[] = [];
    $td.find("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const match = href.match(/\/(\d+(?:,\d+)*)\/?(?:\?|$)/);
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

/**
 * Parse a page with a parts table.
 * The table has columns: No, PNC#, OEM part number, Required per car, Name, Spec, Notes, Color, model_date_range, Price
 *
 * The table.top_cars has an unusual structure where headers and multiple data entries
 * are all in the same row. We find OEM part numbers (like MD341830) and extract
 * data relative to their position.
 */
export function parsePartsPage(
  html: string,
  baseUrl: string,
  diagramId: string
): ParsedDiagramPage {
  const $ = cheerio.load(html);
  const parts: ParsedPart[] = [];

  // Extract page title
  const name = $("h1").first().text().trim() ||
               $("title").text().trim().split(" for ")[0] ||
               diagramId;

  // Find the diagram image
  let imageUrl: string | null = null;
  $("img.parts_picture").each((_, element) => {
    const src = $(element).attr("src");
    if (src && !imageUrl) {
      imageUrl = src.startsWith("http") ? src : new URL(src, baseUrl).toString();
    }
  });

  // Parse the parts table - the actual part details are in table.top_cars
  const $table = $("table.top_cars").first();

  if ($table.length > 0) {
    // Collect all cells from the table into a flat array
    const allCells: string[] = [];
    $table.find("td").each((_, cell) => {
      allCells.push($(cell).text().trim());
    });

    // OEM part number pattern: 2+ letters followed by 4+ alphanumeric chars
    // Examples: MD341830, MR580153, 1145A062
    const oemPattern = /^[A-Z]{1,3}\d{5,}[A-Z0-9]*$|^[A-Z]{2}[A-Z0-9]{4,}$/;

    // Find all OEM part numbers and extract data relative to their position
    // Layout is: [No][PNC][OEM][Qty][Name][Spec][Notes][Color] ... [DateRange] ... [Price]
    for (let i = 0; i < allCells.length; i++) {
      const cell = allCells[i];

      // Skip if this doesn't look like an OEM part number
      if (!oemPattern.test(cell)) continue;

      // Skip header cells (literal "OEM part number" text)
      if (cell.toLowerCase().includes("oem") || cell.toLowerCase().includes("part number")) continue;

      const partNumber = cell;

      // Extract fields relative to OEM position
      // OEM is at position 2 in the pattern: [No(0)][PNC(1)][OEM(2)][Qty(3)][Name(4)][Spec(5)][Notes(6)][Color(7)]
      const refNumber = i >= 2 ? allCells[i - 2] || null : null;
      const pnc = i >= 1 ? allCells[i - 1] || null : null;
      const quantity = allCells[i + 1] ? parseInt(allCells[i + 1]) || null : null;
      const description = allCells[i + 2] || null;
      const spec = allCells[i + 3] || null;
      const notes = allCells[i + 4] || null;
      const color = allCells[i + 5] || null;

      // Look for date range in subsequent cells (within reasonable range)
      let modelDateRange: string | null = null;

      const dateRangePattern = /\d{4}[\.\/-]\d{1,2}[\.\/-]?\d{0,2}\s*[-~]\s*\d{4}[\.\/-]\d{1,2}/;

      // Scan next ~15 cells for date range
      for (let j = i + 1; j < Math.min(i + 16, allCells.length); j++) {
        const scanCell = allCells[j];
        if (!scanCell) continue;

        // Check for date range
        if (!modelDateRange) {
          const dateMatch = scanCell.match(dateRangePattern);
          if (dateMatch) {
            modelDateRange = dateMatch[0];
            break;
          }
        }

        // Stop if we hit another OEM number (next part entry)
        if (j > i + 6 && oemPattern.test(scanCell) && !scanCell.toLowerCase().includes("oem")) {
          break;
        }
      }

      // Validate we have a reasonable part number (not a header like "No" or "PNC#")
      if (partNumber.length < 5) continue;

      // Clean up fields that might contain header text or invalid values
      const cleanField = (val: string | null): string | null => {
        if (!val) return null;
        // Skip if it looks like a header
        if (/^(no|pnc|oem|required|name|spec|notes|color)$/i.test(val)) return null;
        if (val.toLowerCase().includes("per car")) return null;
        return val || null;
      };

      // Validate PNC - should be 5 digits optionally followed by letters (e.g., 02878C, 03195L)
      const cleanPnc = (val: string | null): string | null => {
        if (!val) return null;
        // PNC pattern: 5 digits optionally followed by 1-2 alphanumeric chars
        if (/^\d{5}[A-Z0-9]{0,2}$/i.test(val)) return val;
        // Also accept 4-digit patterns like 3315 or 3315A
        if (/^\d{4}[A-Z0-9]?$/i.test(val)) return val;
        return null;
      };

      const part: ParsedPart = {
        partNumber,
        pnc: cleanPnc(pnc),
        description: cleanField(description),
        refNumber: cleanField(refNumber),
        quantity,
        spec: cleanField(spec),
        notes: cleanField(notes),
        color: cleanField(color),
        modelDateRange,
      };

      parts.push(part);
    }
  }

  return {
    diagram: {
      id: diagramId,
      name,
      imageUrl,
    },
    parts,
  };
}

/**
 * Extract all navigable links from a page.
 */
export function extractAllLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seen = new Set<string>();
  const vehiclePattern = getVehicleUrlPattern();

  const addLink = (href: string | undefined) => {
    if (!href) return;

    // Skip non-navigable links
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.includes("amayama.com") ||
      href.includes("google")
    ) {
      return;
    }

    // Only follow links within our complectation
    if (href.includes("epc-data.com") && !href.includes(vehiclePattern)) {
      return;
    }

    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      const cleanUrl = absoluteUrl.split("#")[0];

      // Must be within our target path
      if (!cleanUrl.includes(vehiclePattern)) {
        return;
      }

      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        links.push(cleanUrl);
      }
    } catch {
      // Invalid URL, skip
    }
  };

  $("a").each((_, element) => addLink($(element).attr("href")));
  $("area").each((_, element) => addLink($(element).attr("href")));

  return links;
}
