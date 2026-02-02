import { getClient, closeClient } from "../src/db/client.ts";
import { createSchema } from "../src/db/schema.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

// Tag definitions organized by category
const TAGS: Record<string, { category: string; patterns: RegExp[] }> = {
  // === SYSTEM TAGS (based on vehicle systems) ===
  "engine": {
    category: "system",
    patterns: [/^engine$/i],
  },
  "transmission": {
    category: "system",
    patterns: [/^automatic-transmission$/i, /^transfer$/i, /A\/T/i, /M\/T/i, /TRANS/i],
  },
  "brakes": {
    category: "system",
    patterns: [/^brake$/i, /BRAKE/i],
  },
  "suspension": {
    category: "system",
    patterns: [/suspension$/i, /SHOCK/i, /STRUT/i, /SPRING,.*COIL/i],
  },
  "steering": {
    category: "system",
    patterns: [/^steering$/i, /STEERING/i, /POWER STEER/i],
  },
  "electrical": {
    category: "system",
    patterns: [/electrical$/i, /WIRING/i, /HARNESS/i, /RELAY/i, /FUSE/i],
  },
  "cooling": {
    category: "system",
    patterns: [/^cooling$/i, /RADIATOR/i, /COOLANT/i, /THERMOSTAT/i, /WATER PUMP/i],
  },
  "fuel-system": {
    category: "system",
    patterns: [/^fuel$/i, /FUEL/i, /INJECTOR/i, /CARBURETOR/i],
  },
  "exhaust": {
    category: "system",
    patterns: [/EXHAUST/i, /MUFFLER/i, /CATALYTIC/i, /MANIFOLD,.*EXH/i],
  },
  "intake": {
    category: "system",
    patterns: [/INTAKE/i, /AIR CLEANER/i, /THROTTLE/i, /MANIFOLD,.*INT/i],
  },
  "hvac": {
    category: "system",
    patterns: [/heater/i, /A\/C/i, /ventilation/i, /BLOWER/i, /EVAPORATOR/i, /CONDENSER/i, /COMPRESSOR,.*A\/C/i],
  },
  "drivetrain": {
    category: "system",
    patterns: [/axle$/i, /DIFFERENTIAL/i, /PROPELLER/i, /DRIVE SHAFT/i, /CV JOINT/i, /TRANSFER/i],
  },
  "body": {
    category: "system",
    patterns: [/^body$/i, /^door$/i, /^interior$/i, /^exterior$/i, /^seat$/i],
  },
  "wheels-tires": {
    category: "system",
    patterns: [/^wheel/i, /TIRE/i, /HUB/i, /LUG NUT/i],
  },
  "lighting": {
    category: "system",
    patterns: [/HEADL/i, /TAIL.*L/i, /LAMP/i, /LIGHT/i, /BULB/i, /TURN SIGNAL/i],
  },
  "lubrication": {
    category: "system",
    patterns: [/^lubrication$/i, /OIL PUMP/i, /OIL PAN/i, /OIL FILTER/i],
  },

  // === COMPONENT TYPE TAGS ===
  "gasket": {
    category: "component",
    patterns: [/GASKET/i],
  },
  "seal": {
    category: "component",
    patterns: [/\bSEAL\b/i, /O-RING/i],
  },
  "bearing": {
    category: "component",
    patterns: [/BEARING/i],
  },
  "bushing": {
    category: "component",
    patterns: [/BUSHING/i],
  },
  "filter": {
    category: "component",
    patterns: [/FILTER/i],
  },
  "belt": {
    category: "component",
    patterns: [/\bBELT\b/i],
  },
  "hose": {
    category: "component",
    patterns: [/\bHOSE\b/i],
  },
  "pump": {
    category: "component",
    patterns: [/\bPUMP\b/i],
  },
  "sensor": {
    category: "component",
    patterns: [/SENSOR/i, /SENDER/i],
  },
  "switch": {
    category: "component",
    patterns: [/SWITCH/i],
  },
  "valve": {
    category: "component",
    patterns: [/\bVALVE\b/i, /\bPCV\b/i, /\bEGR\b/i],
  },
  "motor": {
    category: "component",
    patterns: [/\bMOTOR\b/i, /ACTUATOR/i],
  },
  "spring": {
    category: "component",
    patterns: [/\bSPRING\b/i],
  },
  "mount": {
    category: "component",
    patterns: [/\bMOUNT\b/i, /MOUNTING/i, /BRACKET/i, /INSULATOR/i],
  },
  "fastener": {
    category: "component",
    patterns: [/\bBOLT\b/i, /\bNUT\b/i, /\bSCREW\b/i, /\bSTUD\b/i, /\bWASHER\b/i, /\bCLIP\b/i, /\bCLAMP\b/i],
  },
  "cover": {
    category: "component",
    patterns: [/\bCOVER\b/i, /\bCAP\b/i, /\bLID\b/i],
  },
  "cable": {
    category: "component",
    patterns: [/\bCABLE\b/i, /\bWIRE\b/i],
  },
  "piston": {
    category: "component",
    patterns: [/\bPISTON\b/i, /\bRING,.*PISTON/i],
  },
  "clutch": {
    category: "component",
    patterns: [/\bCLUTCH\b/i],
  },
  "rotor-drum": {
    category: "component",
    patterns: [/\bROTOR\b/i, /\bDRUM\b/i, /\bDISC\b/i],
  },
  "pad-shoe": {
    category: "component",
    patterns: [/\bPAD\b/i, /\bSHOE\b/i, /\bLINING\b/i],
  },
  "caliper": {
    category: "component",
    patterns: [/CALIPER/i],
  },
  "cylinder": {
    category: "component",
    patterns: [/CYLINDER/i],
  },
  "gear": {
    category: "component",
    patterns: [/\bGEAR\b/i, /PINION/i, /SPROCKET/i],
  },
  "shaft": {
    category: "component",
    patterns: [/\bSHAFT\b/i, /AXLE SHAFT/i],
  },
  "linkage": {
    category: "component",
    patterns: [/LINKAGE/i, /\bROD\b/i, /\bARM\b/i, /TIE ROD/i, /BALL JOINT/i],
  },
  "mirror": {
    category: "component",
    patterns: [/MIRROR/i],
  },
  "glass": {
    category: "component",
    patterns: [/\bGLASS\b/i, /WINDSHIELD/i, /WINDOW/i],
  },
  "weather-strip": {
    category: "component",
    patterns: [/WEATHER\s*STRIP/i, /MOLDING/i, /TRIM/i],
  },
  "handle": {
    category: "component",
    patterns: [/HANDLE/i, /KNOB/i, /LEVER/i],
  },
  "latch-lock": {
    category: "component",
    patterns: [/LATCH/i, /\bLOCK\b/i, /STRIKER/i],
  },
  "wiper": {
    category: "component",
    patterns: [/WIPER/i],
  },
  "spark-plug": {
    category: "component",
    patterns: [/SPARK PLUG/i, /IGNITION/i, /COIL,.*IGN/i, /DISTRIBUTOR/i],
  },
  "starter-alternator": {
    category: "component",
    patterns: [/STARTER/i, /ALTERNATOR/i, /GENERATOR/i],
  },
  "battery": {
    category: "component",
    patterns: [/BATTERY/i],
  },

  // === MAINTENANCE TAGS ===
  "maintenance-item": {
    category: "maintenance",
    patterns: [/FILTER/i, /\bBELT\b/i, /SPARK PLUG/i, /\bPAD\b/i, /\bSHOE\b/i, /WIPER.*BLADE/i, /FLUID/i],
  },
  "wear-part": {
    category: "maintenance",
    patterns: [/BEARING/i, /BUSHING/i, /\bSEAL\b/i, /GASKET/i, /O-RING/i, /\bPAD\b/i, /\bSHOE\b/i, /LINING/i, /CLUTCH.*DISC/i],
  },

  // === POSITION TAGS ===
  "front": {
    category: "position",
    patterns: [/\bFRONT\b/i, /\bFR\b/i, /\bFWD\b/i],
  },
  "rear": {
    category: "position",
    patterns: [/\bREAR\b/i, /\bRR\b/i, /\bBACK\b/i],
  },
  "left": {
    category: "position",
    patterns: [/\bLEFT\b/i, /\bLH\b/i, /\,LH$/i],
  },
  "right": {
    category: "position",
    patterns: [/\bRIGHT\b/i, /\bRH\b/i, /\,RH$/i],
  },
  "upper": {
    category: "position",
    patterns: [/\bUPPER\b/i, /\bUPR\b/i, /\bTOP\b/i],
  },
  "lower": {
    category: "position",
    patterns: [/\bLOWER\b/i, /\bLWR\b/i, /\bBOTTOM\b/i],
  },
  "inner": {
    category: "position",
    patterns: [/\bINNER\b/i, /\bINR\b/i],
  },
  "outer": {
    category: "position",
    patterns: [/\bOUTER\b/i, /\bOTR\b/i],
  },
};

async function main() {
  const client = getClient(DEFAULT_CONFIG.dbPath);
  await createSchema(client);

  // Clear existing tags
  await client.execute("DELETE FROM tags_to_parts");
  await client.execute("DELETE FROM tags");

  // Insert all tags
  console.log("Creating tags...");
  for (const [tagId, tagDef] of Object.entries(TAGS)) {
    const name = tagId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    await client.execute({
      sql: "INSERT INTO tags (id, name, category) VALUES (?, ?, ?)",
      args: [tagId, name, tagDef.category],
    });
  }

  // Get all parts with their group info
  console.log("Fetching parts...");
  const parts = await client.execute(`
    SELECT p.id, p.description, p.part_number, g.id as group_id
    FROM parts p
    JOIN groups g ON p.group_id = g.id
  `);

  console.log(`Processing ${parts.rows.length} parts...`);

  const tagAssignments: { sql: string; args: (string | number)[] }[] = [];
  const partTagCounts: Record<string, number> = {};

  for (const part of parts.rows) {
    const partId = part.id as number;
    const description = (part.description as string) || "";
    const groupId = part.group_id as string;
    const assignedTags = new Set<string>();

    // Check each tag's patterns against description and group
    for (const [tagId, tagDef] of Object.entries(TAGS)) {
      for (const pattern of tagDef.patterns) {
        // Match against description
        if (pattern.test(description)) {
          assignedTags.add(tagId);
          break;
        }
        // Match against group ID for system tags
        if (tagDef.category === "system" && pattern.test(groupId)) {
          assignedTags.add(tagId);
          break;
        }
      }
    }

    // Create assignments
    for (const tagId of assignedTags) {
      tagAssignments.push({
        sql: "INSERT OR IGNORE INTO tags_to_parts (tag_id, part_id) VALUES (?, ?)",
        args: [tagId, partId],
      });
      partTagCounts[tagId] = (partTagCounts[tagId] || 0) + 1;
    }
  }

  // Batch insert all assignments
  console.log(`Inserting ${tagAssignments.length} tag assignments...`);

  // Process in batches of 500
  const batchSize = 500;
  for (let i = 0; i < tagAssignments.length; i += batchSize) {
    const batch = tagAssignments.slice(i, i + batchSize);
    await client.batch(batch);
  }

  // Print summary
  console.log("\nTag summary:");
  const sortedTags = Object.entries(partTagCounts).sort((a, b) => b[1] - a[1]);
  for (const [tagId, count] of sortedTags.slice(0, 20)) {
    console.log(`  ${tagId}: ${count} parts`);
  }
  if (sortedTags.length > 20) {
    console.log(`  ... and ${sortedTags.length - 20} more tags`);
  }

  // Verify
  const totalAssignments = await client.execute("SELECT COUNT(*) as count FROM tags_to_parts");
  const totalTags = await client.execute("SELECT COUNT(*) as count FROM tags");
  console.log(`\nTotal: ${totalTags.rows[0].count} tags, ${totalAssignments.rows[0].count} assignments`);

  await closeClient();
}

main();
