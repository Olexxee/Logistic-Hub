import SwaggerParser from "@apidevtools/swagger-parser";

const specPath = new URL("../docs/openapi.yaml", import.meta.url);

try {
  const api = await SwaggerParser.validate(specPath);
  console.log(`OpenAPI contract valid: ${api.info.title} v${api.info.version}`);
} catch (error) {
  console.error("OpenAPI validation failed:", error.message);
  process.exitCode = 1;
}
