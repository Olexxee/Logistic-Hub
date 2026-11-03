import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { nigeriaGeography } from "../seed/nigeria-geography.js";

const COUNTRY = Object.freeze({ code: "NG", name: "Nigeria" });
const EXPECTED_STATE_COUNT = 37;
const EXPECTED_LGA_COUNT = 774;

export function normalizeGeographyName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function fail(message) {
  throw new Error(message);
}

function assertUnique(items, keySelector, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keySelector(item);
    if (key == null || key === "") continue;
    if (seen.has(key)) fail("Duplicate " + label + ": " + key);
    seen.add(key);
  }
}

export function validateNigeriaGeography(dataset = nigeriaGeography) {
  if (!Array.isArray(dataset)) fail("Nigeria geography dataset must be an array.");
  if (dataset.length !== EXPECTED_STATE_COUNT) {
    fail("Expected " + EXPECTED_STATE_COUNT + " state-level units; received " + dataset.length + ".");
  }

  assertUnique(dataset, (item) => normalizeGeographyName(item.name), "state name");
  assertUnique(dataset, (item) => item.code, "state code");
  assertUnique(dataset, (item) => item.sourceId, "state source ID");

  let lgaCount = 0;
  const allLgaSourceIds = [];

  for (const state of dataset) {
    if (!state || typeof state.name !== "string" || !state.name.trim()) fail("Every state-level unit must have a name.");
    if (!/^NG-[A-Z]{2}$/.test(state.code ?? "")) fail("Invalid state code for " + state.name + ".");
    if (!/^NG\d{3}$/.test(state.sourceId ?? "")) fail("Invalid source state ID for " + state.name + ".");
    if (!["STATE", "FCT"].includes(state.type)) fail("Invalid administrative type for " + state.name + ".");
    if (!Array.isArray(state.lgas)) fail("LGAs must be an array for " + state.name + ".");
    if (state.expectedLgaCount !== state.lgas.length) {
      fail("Expected LGA count mismatch for " + state.name + ": metadata says " + state.expectedLgaCount + ", dataset contains " + state.lgas.length + ".");
    }

    assertUnique(state.lgas, (item) => normalizeGeographyName(item.name), "LGA name in " + state.name);
    assertUnique(state.lgas, (item) => item.code, "LGA code in " + state.name);

    for (const lga of state.lgas) {
      if (!lga || typeof lga.name !== "string" || !lga.name.trim()) fail("Empty LGA name in " + state.name + ".");
      if (!/^NG\d{6}$/.test(lga.sourceId ?? "")) fail("Invalid source LGA ID for " + state.name + " / " + lga.name + ".");
      if (!lga.sourceId.startsWith(state.sourceId)) fail("LGA source ID does not belong to parent state " + state.name + " / " + lga.name + ".");
      if (lga.code !== lga.sourceId) fail("LGA code must equal its stable source ID for " + state.name + " / " + lga.name + ".");
      allLgaSourceIds.push(lga.sourceId);
      lgaCount += 1;
    }
  }

  const fctUnits = dataset.filter((item) => item.type === "FCT");
  if (fctUnits.length !== 1 || fctUnits[0].name !== "Federal Capital Territory") {
    fail("Dataset must contain exactly one Federal Capital Territory entry.");
  }
  if (fctUnits[0].lgas.length !== 6) fail("FCT must contain exactly six Area Councils.");
  if (lgaCount !== EXPECTED_LGA_COUNT) fail("Expected exactly " + EXPECTED_LGA_COUNT + " LGAs/Area Councils; received " + lgaCount + ".");
  assertUnique(allLgaSourceIds, (value) => value, "LGA source ID");

  return { stateCount: dataset.length, lgaCount, fctAreaCouncilCount: fctUnits[0].lgas.length };
}

function findSingleCandidate(rows, predicate, label) {
  const matches = rows.filter(predicate);
  if (matches.length > 1) fail("Conflicting existing geography records: multiple matches for " + label + ".");
  return matches[0] ?? null;
}

function assertNoExistingDuplicates(rows, label) {
  assertUnique(rows, (row) => normalizeGeographyName(row.name), "existing " + label + " name");
  assertUnique(rows, (row) => row.code, "existing " + label + " code");
}

export function buildNigeriaGeographyPlan(existing, dataset = nigeriaGeography) {
  validateNigeriaGeography(dataset);

  const country = findSingleCandidate(
    existing.countries ?? [],
    (row) => row.code === COUNTRY.code || normalizeGeographyName(row.name) === normalizeGeographyName(COUNTRY.name),
    COUNTRY.name,
  );

  if (country && (country.code !== COUNTRY.code || normalizeGeographyName(country.name) !== normalizeGeographyName(COUNTRY.name))) {
    fail("Existing country code/name conflicts with the Nigeria reference record; no changes were made.");
  }

  const existingStates = existing.states ?? [];
  if (!country && existingStates.length) fail("State records were found without a matching Nigeria country record.");
  assertNoExistingDuplicates(existingStates, "state");

  const matchedStateIds = new Set();
  const statePlans = dataset.map((stateData) => {
    const existingState = findSingleCandidate(
      existingStates,
      (row) => row.code === stateData.code || normalizeGeographyName(row.name) === normalizeGeographyName(stateData.name),
      stateData.name,
    );

    if (existingState) {
      if (normalizeGeographyName(existingState.name) !== normalizeGeographyName(stateData.name) || existingState.code !== stateData.code) {
        fail("Existing state code/name conflicts with reference data for " + stateData.name + ".");
      }
      matchedStateIds.add(existingState.id);
    }

    const existingLgas = existingState
      ? (existing.lgas ?? []).filter((row) => row.stateId === existingState.id)
      : [];
    assertNoExistingDuplicates(existingLgas, "LGA in " + stateData.name);

    const matchedLgaIds = new Set();
    const createLgas = [];
    for (const lgaData of stateData.lgas) {
      const existingLga = findSingleCandidate(
        existingLgas,
        (row) => row.code === lgaData.code || normalizeGeographyName(row.name) === normalizeGeographyName(lgaData.name),
        stateData.name + " / " + lgaData.name,
      );

      if (!existingLga) {
        createLgas.push(lgaData);
        continue;
      }

      if (normalizeGeographyName(existingLga.name) !== normalizeGeographyName(lgaData.name)) {
        fail("Existing LGA code maps to a different name in " + stateData.name + ": " + lgaData.code + ".");
      }
      if (existingLga.code != null && existingLga.code !== lgaData.code) {
        fail("Existing LGA code conflicts with reference data for " + stateData.name + " / " + lgaData.name + ".");
      }
      matchedLgaIds.add(existingLga.id);
    }

    const extraLgas = existingLgas.filter((row) => !matchedLgaIds.has(row.id));
    if (extraLgas.length) {
      fail("Unrecognised existing LGAs in " + stateData.name + ": " + extraLgas.map((row) => row.name).join(", ") + ". Resolve these records before seeding.");
    }

    return {
      data: stateData,
      existing: existingState,
      createLgas,
      matchedLgaCount: stateData.lgas.length - createLgas.length,
    };
  });

  const extraStates = existingStates.filter((row) => !matchedStateIds.has(row.id));
  if (extraStates.length) {
    fail("Unrecognised existing state records under Nigeria: " + extraStates.map((row) => row.name).join(", ") + ". Resolve these records before seeding.");
  }

  return {
    country,
    createCountry: !country,
    states: statePlans,
    matchedStateCount: statePlans.filter((item) => item.existing).length,
    createStateCount: statePlans.filter((item) => !item.existing).length,
    matchedLgaCount: statePlans.reduce((total, item) => total + item.matchedLgaCount, 0),
    createLgaCount: statePlans.reduce((total, item) => total + item.createLgas.length, 0),
  };
}

async function readExistingGeography(client) {
  const countries = await client.country.findMany({
    where: { OR: [{ code: COUNTRY.code }, { name: { equals: COUNTRY.name, mode: "insensitive" } }] },
    select: { id: true, code: true, name: true },
  });

  if (countries.length > 1) {
    fail("More than one country record matches Nigeria by code or name. Resolve the conflict before seeding.");
  }

  const country = countries[0] ?? null;
  const states = country
    ? await client.state.findMany({
      where: { countryId: country.id },
      select: { id: true, countryId: true, code: true, name: true },
    })
    : [];

  const lgas = states.length
    ? await client.lGA.findMany({
      where: { stateId: { in: states.map((state) => state.id) } },
      select: { id: true, stateId: true, code: true, name: true },
    })
    : [];

  return { countries, states, lgas };
}

async function createPlan(client) {
  return buildNigeriaGeographyPlan(await readExistingGeography(client));
}

function printPlan(plan, database) {
  console.log("\nNigeria geography seed — DRY RUN");
  console.log("Database target: " + database.name + " @ " + database.host);
  console.log("Country: " + (plan.createCountry ? "CREATE Nigeria (NG)" : "MATCH existing Nigeria"));
  console.log("States: " + plan.matchedStateCount + " matched; " + plan.createStateCount + " to create.");
  console.log("LGAs/Area Councils: " + plan.matchedLgaCount + " matched; " + plan.createLgaCount + " to create.");
  console.log("\nPer-state additions:");
  for (const item of plan.states) {
    if (item.createLgas.length || !item.existing) {
      console.log("  " + item.data.name + ": " + (item.existing ? "state matched" : "state to create") + "; " + item.createLgas.length + " LGAs to create.");
    }
  }
  console.log("\nNo database writes were performed.");
  console.log("To apply, pass --apply --confirm-database=" + database.name + (process.env.NODE_ENV === "production" ? " --allow-production" : "") + ".");
}

async function applyNigeriaGeography(client) {
  return client.$transaction(async (tx) => {
    const plan = await createPlan(tx);
    let country = plan.country;
    let createdStateCount = 0;
    let createdLgaCount = 0;

    if (!country) {
      country = await tx.country.create({ data: { code: COUNTRY.code, name: COUNTRY.name } });
    }

    for (const item of plan.states) {
      const state = item.existing ?? await tx.state.create({
        data: { countryId: country.id, code: item.data.code, name: item.data.name },
      });
      if (!item.existing) createdStateCount += 1;

      if (item.createLgas.length) {
        const result = await tx.lGA.createMany({
          data: item.createLgas.map((lga) => ({
            stateId: state.id,
            code: lga.code,
            name: lga.name,
          })),
        });
        createdLgaCount += result.count;
      }
    }

    const persistedStates = await tx.state.findMany({
      where: { countryId: country.id },
      select: { id: true },
    });
    const persistedLgaCount = await tx.lGA.count({
      where: { stateId: { in: persistedStates.map((state) => state.id) } },
    });

    if (persistedStates.length !== EXPECTED_STATE_COUNT || persistedLgaCount !== EXPECTED_LGA_COUNT) {
      fail("Post-seed verification failed: found " + persistedStates.length + " states and " + persistedLgaCount + " LGAs.");
    }

    return {
      countryCreated: plan.createCountry,
      statesCreated: createdStateCount,
      statesMatched: plan.matchedStateCount,
      lgasCreated: createdLgaCount,
      lgasMatched: plan.matchedLgaCount,
      totalStates: persistedStates.length,
      totalLgas: persistedLgaCount,
    };
  }, {
    isolationLevel: "Serializable",
    maxWait: 10000,
    timeout: 120000,
  });
}

function parseArguments(args) {
  const allowed = new Set(["--apply", "--dry-run", "--allow-production"]);
  for (const arg of args) {
    if (allowed.has(arg) || arg.startsWith("--confirm-database=")) continue;
    fail("Unknown argument: " + arg);
  }
  if (args.includes("--apply") && args.includes("--dry-run")) {
    fail("--apply and --dry-run cannot be used together.");
  }
  const confirmationArgs = args.filter((arg) => arg.startsWith("--confirm-database="));
  if (confirmationArgs.length > 1) fail("Provide --confirm-database only once.");
  const confirmArg = confirmationArgs[0];
  return {
    apply: args.includes("--apply"),
    allowProduction: args.includes("--allow-production"),
    confirmDatabase: confirmArg ? confirmArg.slice("--confirm-database=".length) : null,
  };
}

export async function runNigeriaGeographySeed(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const datasetStats = validateNigeriaGeography();

  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required. No database connection was attempted.");
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
  if (!databaseName) fail("DATABASE_URL must include a database name.");
  const database = { name: databaseName, host: databaseUrl.hostname };

  if (options.apply && options.confirmDatabase !== databaseName) {
    fail("Apply requires --confirm-database=" + databaseName + " to confirm the exact target database.");
  }
  if (options.allowProduction && !options.apply) {
    fail("--allow-production is valid only together with --apply.");
  }
  if (options.apply && process.env.NODE_ENV === "production" && !options.allowProduction) {
    fail("Production execution is blocked. Add --allow-production only after independently confirming the target database.");
  }

  const client = new PrismaClient();
  try {
    if (!options.apply) {
      const plan = await createPlan(client);
      printPlan(plan, database);
      console.log("Dataset validated: " + datasetStats.stateCount + " state-level units; " + datasetStats.lgaCount + " LGAs; " + datasetStats.fctAreaCouncilCount + " FCT Area Councils.");
      return;
    }

    const result = await applyNigeriaGeography(client);
    console.log("\nNigeria geography seed applied successfully.");
    console.log(JSON.stringify({ database, dataset: datasetStats, result }, null, 2));
    console.log("No service zones, availability, hubs, partners or other operational records were created or modified.");
  } finally {
    await client.$disconnect();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runNigeriaGeographySeed().catch((error) => {
    console.error("Nigeria geography seed failed: " + error.message);
    process.exitCode = 1;
  });
}
