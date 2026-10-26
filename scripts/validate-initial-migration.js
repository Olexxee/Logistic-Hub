import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("../prisma/migrations/20261026121500_initial_foundation/migration.sql", import.meta.url),
);
const constraintsPath = fileURLToPath(
  new URL("../prisma/constraints/foundation.sql", import.meta.url),
);

const migration = readFileSync(migrationPath, "utf8");
const constraints = readFileSync(constraintsPath, "utf8");

if (!migration.endsWith(constraints)) {
  console.error(
    "Initial migration drift: the committed migration must retain the exact initial supplemental constraints snapshot.",
  );
  process.exitCode = 1;
} else {
  console.log("Initial migration snapshot valid: supplemental foundation constraints match.");
}
