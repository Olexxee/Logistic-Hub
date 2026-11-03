import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const migrationsDirectory = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const migrationPath = join(
  migrationsDirectory,
  "20261103100000_foundation_integrity_constraints",
  "migration.sql",
);
const constraintsPath = fileURLToPath(
  new URL("../prisma/constraints/foundation.sql", import.meta.url),
);

const migrationFiles = readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsDirectory, entry.name, "migration.sql"));

const bomMigrations = migrationFiles.filter((path) => {
  try {
    return readFileSync(path, "utf8").charCodeAt(0) === 0xfeff;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
});

if (bomMigrations.length) {
  console.error("Migration SQL files must be UTF-8 without a BOM: " + bomMigrations.join(", "));
  process.exitCode = 1;
} else {
  console.log("Migration SQL encoding valid: no UTF-8 BOMs found.");
}

const migration = readFileSync(migrationPath, "utf8");
const constraints = readFileSync(constraintsPath, "utf8");

if (!migration.endsWith(constraints)) {
  console.error(
    "Foundation integrity migration drift: the timestamped migration must retain the exact committed constraints snapshot.",
  );
  process.exitCode = 1;
} else {
  console.log("Foundation integrity migration snapshot valid.");
}
