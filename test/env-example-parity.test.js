import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("backend .env.example documents every key declared by the runtime environment schema", async () => {
  const [schema, example] = await Promise.all([
    readFile(resolve(root, "src/config/env.js"), "utf8"),
    readFile(resolve(root, ".env.example"), "utf8"),
  ]);
  const schemaKeys = [...schema.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s/gm)].map(match => match[1]);
  const exampleKeys = new Set([...example.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]));
  const missing = schemaKeys.filter(key => !exampleKeys.has(key));
  assert.deepEqual(missing, [], `Add missing runtime environment keys to .env.example: ${missing.join(", ")}`);
});