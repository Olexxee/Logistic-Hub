import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("../prisma/migrations/20261103100000_foundation_integrity_constraints/migration.sql", import.meta.url),
);
const constraintsPath = fileURLToPath(
  new URL("../prisma/constraints/foundation.sql", import.meta.url),
);

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
