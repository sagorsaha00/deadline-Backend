import { runDeadlineChecks } from "../jobs/deadlineScheduler.js";
import { prisma } from "../config/db.js";

async function testScheduler() {
  console.log("=== Testing Deadline Scheduler & Deduplication ===");

  // Run first check
  console.log("Running pass 1 of deadline checks...");
  const pass1 = await runDeadlineChecks();
  console.log("Pass 1 results:", pass1);

  // Run second check immediately (concurrency / deduplication test)
  console.log("\nRunning pass 2 of deadline checks immediately (should send 0 duplicate reminders)...");
  const pass2 = await runDeadlineChecks();
  console.log("Pass 2 results:", pass2);

  if (pass2.remindersSent === 0 && pass2.overdueSent === 0) {
    console.log("\n[PASSED] Deduplication verified: Exactly 0 duplicates sent on repeated check!");
  } else {
    throw new Error(`Deduplication failure: sent ${pass2.remindersSent} reminders and ${pass2.overdueSent} overdue alerts on pass 2!`);
  }

  // Check email logs
  const emailLogs = await prisma.emailLog.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  console.log(`\nEmail logs recorded in database: ${emailLogs.length}`);
  emailLogs.forEach((l) => {
    console.log(`- To: ${l.to} | Subject: "${l.subject}" | Status: ${l.status}`);
  });

  console.log("\n=== Scheduler Deduplication Verification Passed! ===");
}

testScheduler()
  .catch((e) => {
    console.error("Scheduler test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
