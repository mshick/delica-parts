/**
 * Bootstrap script - fetches vehicle info from frame number and updates .env
 *
 * Run with: deno task bootstrap
 */

import { load as loadCheerio } from "cheerio";

const ENV_PATH = "../.env";

interface EnvVars {
  FRAME_NO?: string;
  VEHICLE_NAME?: string;
  FRAME_NAME?: string;
  TRIM_CODE?: string;
  EXTERIOR_CODE?: string;
  INTERIOR_CODE?: string;
  MANUFACTURE_DATE?: string;
}

async function loadEnv(): Promise<EnvVars> {
  try {
    const content = await Deno.readTextFile(ENV_PATH);
    const vars: EnvVars = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      (vars as Record<string, string>)[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

async function saveEnv(vars: EnvVars): Promise<void> {
  const lines: string[] = [];
  if (vars.FRAME_NO) lines.push(`FRAME_NO=${vars.FRAME_NO}`);
  if (vars.VEHICLE_NAME) lines.push(`VEHICLE_NAME=${vars.VEHICLE_NAME}`);
  if (vars.FRAME_NAME) lines.push(`FRAME_NAME=${vars.FRAME_NAME}`);
  if (vars.TRIM_CODE) lines.push(`TRIM_CODE=${vars.TRIM_CODE}`);
  if (vars.EXTERIOR_CODE) lines.push(`EXTERIOR_CODE=${vars.EXTERIOR_CODE}`);
  if (vars.INTERIOR_CODE) lines.push(`INTERIOR_CODE=${vars.INTERIOR_CODE}`);
  if (vars.MANUFACTURE_DATE) lines.push(`MANUFACTURE_DATE=${vars.MANUFACTURE_DATE}`);
  await Deno.writeTextFile(ENV_PATH, lines.join("\n") + "\n");
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (response.ok) {
      return response;
    }

    if (response.status === 429 && attempt < maxRetries) {
      const delay = attempt * 5000; // 5s, 10s, 15s
      console.log(`Rate limited. Waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
      await sleep(delay);
      continue;
    }

    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  throw new Error("Max retries exceeded");
}

async function fetchVehicleInfo(frameNo: string): Promise<{
  vehicleName: string;
  frameName: string;
  trimCode: string;
  exteriorCode: string;
  interiorCode: string;
  manufactureDate: string;
}> {
  // Submit frame number to the search page
  const searchUrl = `https://mitsubishi.epc-data.com/delica_space_gear/?frame_no=${encodeURIComponent(frameNo)}`;

  console.log(`Fetching vehicle info for frame: ${frameNo}`);
  console.log(`URL: ${searchUrl}`);

  const response = await fetchWithRetry(searchUrl);

  const html = await response.text();
  const $ = loadCheerio(html);

  // Extract frame name and trim code from the redirect URL or page content
  // The URL pattern is: /delica_space_gear/{frame_name}/{trim_code}/
  const finalUrl = response.url;
  const urlMatch = finalUrl.match(/\/delica_space_gear\/([^/]+)\/([^/]+)/);

  if (!urlMatch) {
    throw new Error(`Could not parse vehicle URL: ${finalUrl}`);
  }

  const frameName = urlMatch[1];
  const trimCode = urlMatch[2];

  // Extract vehicle name from page title or header
  // Format: "Delica Space Gear - HSEUE9 Chamonix (HIGH-ROOF), 4CA/T complectation"
  let vehicleName = "";

  // Try page title first
  const pageTitle = $("title").text().trim();
  if (pageTitle && pageTitle.includes("Delica")) {
    // Clean up the title - remove site name suffix if present
    vehicleName = pageTitle.replace(/\s*[-|].*epc-data.*$/i, "").trim();
  }

  // Try h1 or header element
  if (!vehicleName) {
    const h1Text = $("h1").first().text().trim();
    if (h1Text && h1Text.includes("Delica")) {
      vehicleName = h1Text;
    }
  }

  // Try breadcrumb or complectation info
  if (!vehicleName) {
    $(".breadcrumb a, .complectation, #complectation").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("Delica") || text.includes(trimCode.toUpperCase())) {
        vehicleName = vehicleName || text;
      }
    });
  }

  // Parse vehicle details from the page
  // Look for the vehicle info table/section
  let exteriorCode = "";
  let interiorCode = "";
  let manufactureDate = "";

  // Try to find vehicle details in the page
  // The page typically has a table or section with vehicle specifications
  $("table tr, .vehicle-info div, dl dt, .spec-row").each((_, el) => {
    const text = $(el).text();

    // Look for exterior color code
    if (text.match(/exterior|ext\.?\s*col|body\s*col/i)) {
      const match = text.match(/([A-Z0-9]{2,4})\s*$/);
      if (match) exteriorCode = match[1];
    }

    // Look for interior color code
    if (text.match(/interior|int\.?\s*col|trim\s*col/i)) {
      const match = text.match(/([A-Z0-9]{2,4})\s*$/);
      if (match) interiorCode = match[1];
    }

    // Look for manufacture date
    if (text.match(/manufact|prod.*date|build.*date/i)) {
      const match = text.match(/(\d{4}\.\d{1,2}\.\d{1,2})/);
      if (match) manufactureDate = match[1];
    }
  });

  // Alternative: look for specific patterns in all text
  const pageText = $("body").text();

  // Frame info section often contains "W09M" type codes
  if (!exteriorCode) {
    const extMatch = pageText.match(/(?:exterior|ext\.?\s*col)[:\s]*([A-Z0-9]{2,4})/i);
    if (extMatch) exteriorCode = extMatch[1];
  }

  if (!interiorCode) {
    const intMatch = pageText.match(/(?:interior|int\.?\s*col)[:\s]*([A-Z0-9]{2,4})/i);
    if (intMatch) interiorCode = intMatch[1];
  }

  if (!manufactureDate) {
    const dateMatch = pageText.match(/(?:manufact|production)[:\s]*(\d{4}\.\d{1,2}\.\d{1,2})/i);
    if (dateMatch) manufactureDate = dateMatch[1];
  }

  // If we still can't find them, check the URL parameters or look for a data table
  $("td").each((i, el) => {
    const text = $(el).text().trim();
    const nextTd = $(el).next("td").text().trim();

    if (text.match(/exterior/i) && nextTd) {
      exteriorCode = exteriorCode || nextTd;
    }
    if (text.match(/interior/i) && nextTd) {
      interiorCode = interiorCode || nextTd;
    }
    if (text.match(/date|manufact/i) && nextTd.match(/\d{4}\.\d/)) {
      manufactureDate = manufactureDate || nextTd;
    }
  });

  console.log("\nParsed vehicle info:");
  console.log(`  Vehicle Name: ${vehicleName || "(not found)"}`);
  console.log(`  Frame Name: ${frameName}`);
  console.log(`  Trim Code: ${trimCode}`);
  console.log(`  Exterior Code: ${exteriorCode || "(not found)"}`);
  console.log(`  Interior Code: ${interiorCode || "(not found)"}`);
  console.log(`  Manufacture Date: ${manufactureDate || "(not found)"}`);

  return {
    vehicleName,
    frameName,
    trimCode,
    exteriorCode,
    interiorCode,
    manufactureDate,
  };
}

async function main() {
  console.log("Delica Parts Scraper - Bootstrap");
  console.log("=================================\n");

  // Load existing .env
  let env = await loadEnv();

  // Prompt for frame number if not set
  if (!env.FRAME_NO) {
    const frameNo = prompt("Enter vehicle frame number (e.g., PD6W-0500900):");
    if (!frameNo) {
      console.error("Frame number is required.");
      Deno.exit(1);
    }
    env.FRAME_NO = frameNo.trim();
    await saveEnv(env);
    console.log(`\nSaved FRAME_NO=${env.FRAME_NO} to .env\n`);
  } else {
    console.log(`Using existing FRAME_NO=${env.FRAME_NO}\n`);
  }

  // Fetch vehicle info
  try {
    const info = await fetchVehicleInfo(env.FRAME_NO);

    // Update env with fetched values
    if (info.vehicleName) env.VEHICLE_NAME = info.vehicleName;
    env.FRAME_NAME = info.frameName;
    env.TRIM_CODE = info.trimCode;
    if (info.exteriorCode) env.EXTERIOR_CODE = info.exteriorCode;
    if (info.interiorCode) env.INTERIOR_CODE = info.interiorCode;
    if (info.manufactureDate) env.MANUFACTURE_DATE = info.manufactureDate;

    await saveEnv(env);
    console.log("\n.env updated successfully!");

  } catch (error) {
    console.error(`\nError fetching vehicle info: ${error}`);
    console.error("\nYou may need to manually add the following to .env:");
    console.error("  FRAME_NAME=pd6w");
    console.error("  TRIM_CODE=hseue9");
    console.error("  EXTERIOR_CODE=W09M");
    console.error("  INTERIOR_CODE=57A");
    console.error("  MANUFACTURE_DATE=1999.08.3");
    Deno.exit(1);
  }
}

main();
