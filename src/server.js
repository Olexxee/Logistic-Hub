import { app } from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.PORT, () => {
  console.info(`Logistic Hub API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal) {
  console.info(`${signal} received; closing HTTP server`);
  server.close(async (error) => {
    if (error) {
      console.error("Failed to close HTTP server cleanly", error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
