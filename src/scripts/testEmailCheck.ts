import { prisma } from "../config/db.js";
import { verifySmtpConnection } from "../modules/emails/emailService.js";

async function main() {
  console.log("=== CHECKING GMAIL SMTP CONNECTION ===");
  const smtpStatus = await verifySmtpConnection();
  console.log("SMTP Status:", smtpStatus);

  console.log("\n=== CHECKING RECENT EMAIL LOGS ===");
  const logs = await prisma.emailLog.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
  });
  for (const log of logs) {
    console.log(`[${log.createdAt.toISOString()}] Status: ${log.status} | Provider: ${log.provider} | To: ${log.to || log.recipient} | Subject: "${log.subject}" | Event: ${log.eventType} | Error: ${log.errorMessage || "none"}`);
  }
}

main().finally(() => prisma.$disconnect());
