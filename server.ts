import "dotenv/config";
import app from "./src/app.js";
import { env } from "./src/config/env.js";
import { prisma } from "./src/config/db.js";
import { initDeadlineCron } from "./src/jobs/deadlineScheduler.js";

const PORT = env.PORT;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[DeadlineHub] API server listening on http://0.0.0.0:${PORT}`);
  initDeadlineCron();
});

async function gracefulShutdown(signal: string) {
  console.log(`\n[DeadlineHub] Received ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("[DeadlineHub] Database disconnected. Exiting cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("[DeadlineHub] Error during disconnect:", err);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
