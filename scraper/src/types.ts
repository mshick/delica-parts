// Database record types
export interface Group {
  id: string;
  name: string;
}

export interface Subgroup {
  id: string;
  name: string;
  group_id: string;
  path: string;
}

export interface Diagram {
  id: string;
  group_id: string;
  subgroup_id: string | null;
  name: string;
  image_url: string | null;
  image_path: string | null;
  source_url: string;
}

export interface Part {
  id?: number;
  detail_page_id: string | null;
  part_number: string;
  pnc: string | null;
  description: string | null;
  ref_number: string | null;
  quantity: number | null;
  spec: string | null;
  notes: string | null;
  color: string | null;
  model_date_range: string | null;
  diagram_id: string;
  group_id: string;
  subgroup_id: string | null;
  replacement_part_number: string | null;
}

export interface ScrapeProgress {
  url: string;
  status: "pending" | "completed" | "failed";
  scraped_at: string | null;
  error: string | null;
}

// Parsed data types
export interface ParsedGroup {
  id: string;
  name: string;
  url: string;
}

export interface ParsedSubgroup {
  id: string;
  name: string;
  url: string;
  groupId: string;
}

export interface ParsedDiagram {
  id: string;
  name: string;
  url: string;
  groupId: string;
  subgroupId: string | null;
}

export interface ParsedPart {
  partNumber: string;
  pnc: string | null;
  description: string | null;
  refNumber: string | null;
  quantity: number | null;
  spec: string | null;
  notes: string | null;
  color: string | null;
  modelDateRange: string | null;
}

export interface ParsedDiagramPage {
  diagram: {
    id: string;
    name: string;
    imageUrl: string | null;
  };
  parts: ParsedPart[];
}

// Scraper configuration
export interface ScraperConfig {
  baseUrl: string;
  frameNumber: string;
  initialDelay: number;
  minDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  dataDir: string;
  imagesDir: string;
  dbPath: string;
}

// Load from environment variables with fallbacks
const frameName = Deno.env.get("FRAME_NAME") || "pd6w";
const trimCode = Deno.env.get("TRIM_CODE") || "hseue9";
const frameNumber = Deno.env.get("FRAME_NO") || "PD6W-0500900";

export const DEFAULT_CONFIG: ScraperConfig = {
  baseUrl: `https://mitsubishi.epc-data.com/delica_space_gear/${frameName}/${trimCode}/`,
  frameNumber: frameNumber,
  initialDelay: 3000,   // 3 seconds
  minDelay: 1000,       // 1 second minimum
  maxDelay: 120000,     // 2 minutes max
  backoffMultiplier: 1.5, // Gentler backoff
  dataDir: "../data",
  imagesDir: "../data/images",
  dbPath: "../data/delica.db",
};
