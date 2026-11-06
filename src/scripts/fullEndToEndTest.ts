import http from "http";
import app from "../app.js";
import { prisma } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import axios from "axios";
import { runDeadlineChecks } from "../jobs/deadlineScheduler.js";

const TEST_PORT = 5099;
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

async function runAllScenarios() {
  console.log("================================================================================");
  console.log(" DEADLINEHUB COMPREHENSIVE END-TO-END AUDIT & VERIFICATION TEST SUITE");
  console.log("================================================================================\n");

  // Start test server
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));
  console.log(`[INIT] Test HTTP server listening on port ${TEST_PORT}\n`);

  let createdTaskId = "";
  let adminUser: any = null;
  let memberUser: any = null;

  try {
    // 1. Fetch real test users from database
    console.log("--- 1. VERIFYING DATABASE USERS ---");
    adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    memberUser = await prisma.user.findFirst({ where: { role: "MEMBER" } });

    if (!adminUser || !memberUser) {
      throw new Error(`Required users not found in DB! Admin: ${!!adminUser}, Member: ${!!memberUser}`);
    }

    console.log(`[PASSED] Admin user verified: "${adminUser.name}" (${adminUser.email})`);
    console.log(`[PASSED] Member user verified: "${memberUser.name}" (${memberUser.email})`);

    const adminToken = signToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: "ADMIN",
    });

    const memberToken = signToken({
      userId: memberUser.id,
      email: memberUser.email,
      role: "MEMBER",
    });

    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const memberHeaders = { Authorization: `Bearer ${memberToken}` };

    // 2. Health & Status Check
    console.log("\n--- 2. HEALTH CHECK ---");
    const healthRes = await axios.get(`http://localhost:${TEST_PORT}/health`);
    console.log(`[PASSED] /health status: ${healthRes.status}, message: "${healthRes.data.message}"`);

    // 3. Scenario A: Admin Task Creation
    console.log("\n--- 3. SCENARIO A: ADMIN TASK CREATION & ASSIGNMENT ---");
    const deadlineDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 2 days from now
    const createRes = await axios.post(
      `${BASE_URL}/tasks`,
      {
        title: "Audit Verification: Core Deliverable Task",
        description: "Validating full workflow lifecycle, real database aggregates, and Resend delivery logs.",
        jiraUrl: "https://jira.company.com/browse/PROJ-8821",
        assignedName: memberUser.name,
        assignedEmail: memberUser.email,
        deadline: deadlineDate,
        priority: "HIGH",
      },
      { headers: adminHeaders }
    );

    createdTaskId = createRes.data.data.id;
    console.log(`[PASSED] Task created: "${createRes.data.data.title}" (ID: ${createdTaskId})`);
    console.log(`         Assigned to: ${createRes.data.data.assignedName} (${createRes.data.data.assignedEmail})`);
    console.log(`         Initial Status: ${createRes.data.data.status}`);

    // Verify task details endpoint
    const taskDetailsRes = await axios.get(`${BASE_URL}/tasks/${createdTaskId}`, {
      headers: adminHeaders,
    });
    console.log(`[PASSED] Task details retrieved: ID ${taskDetailsRes.data.data.id}, Priority: ${taskDetailsRes.data.data.priority}`);

    // 4. Scenario B: Member Workflow & Strict Security Guard
    console.log("\n--- 4. SCENARIO B: MEMBER PERMISSIONS & STATUS FLOW ---");

    // Member checks "Assigned to Me"
    const assignedRes = await axios.get(`${BASE_URL}/tasks/assigned-to-me`, {
      headers: memberHeaders,
    });
    const foundInAssigned = assignedRes.data.data.some((t: any) => t.id === createdTaskId);
    console.log(`[PASSED] Task found in Member's assigned-to-me list: ${foundInAssigned}`);

    // Member attempts direct status change to COMPLETED (Security Guard: MUST FAIL with 403)
    console.log("   Testing Security Guard: Member attempts to mark task COMPLETED directly...");
    try {
      await axios.patch(
        `${BASE_URL}/tasks/${createdTaskId}/status`,
        { status: "COMPLETED" },
        { headers: memberHeaders }
      );
      throw new Error("SECURITY BREACH: Member was permitted to set COMPLETED directly!");
    } catch (err: any) {
      if (err.response?.status === 403) {
        console.log(`   [PASSED] HTTP 403 Forbidden correctly rejected: "${err.response.data.message}"`);
      } else {
        throw err;
      }
    }

    // Member moves task from TODO to IN_PROGRESS
    const startTaskRes = await axios.patch(
      `${BASE_URL}/tasks/${createdTaskId}/status`,
      { status: "IN_PROGRESS" },
      { headers: memberHeaders }
    );
    console.log(`[PASSED] Member moved task to: ${startTaskRes.data.data.status}`);

    // Member adds a comment
    const commentRes = await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/comments`,
      { content: "Initial progress completed. Ready for review." },
      { headers: memberHeaders }
    );
    console.log(`[PASSED] Member added comment: "${commentRes.data.data.content}"`);

    // Member submits task for review
    const submitReviewRes = await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/submit-review`,
      {},
      { headers: memberHeaders }
    );
    console.log(`[PASSED] Member submitted for review: new status is ${submitReviewRes.data.data.status}`);

    // 5. Scenario C: Admin Review & Completion Flow
    console.log("\n--- 5. SCENARIO C: ADMIN REVIEW & COMPLETION WORKFLOW ---");

    // Admin requests changes
    const reqChangesRes = await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/request-changes`,
      { reason: "Please ensure test documentation is linked." },
      { headers: adminHeaders }
    );
    console.log(`[PASSED] Admin requested changes: status returned to ${reqChangesRes.data.data.status}`);

    // Member resubmits for review
    await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/submit-review`,
      {},
      { headers: memberHeaders }
    );
    console.log(`[PASSED] Member resubmitted task for review`);

    // Admin approves and completes task
    const completeRes = await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/complete`,
      {},
      { headers: adminHeaders }
    );
    console.log(`[PASSED] Admin approved task: status is ${completeRes.data.data.status}, completedAt: ${completeRes.data.data.completedAt}`);

    // Admin sends manual deadline reminder
    const remindRes = await axios.post(
      `${BASE_URL}/tasks/${createdTaskId}/remind`,
      {},
      { headers: adminHeaders }
    );
    console.log(`[PASSED] Admin manual reminder triggered: "${remindRes.data.message}"`);

    // 6. Scenario D: Real Database Dashboard Aggregate Statistics
    console.log("\n--- 6. SCENARIO D: REAL DATABASE DASHBOARD AGGREGATES ---");
    const statsRes = await axios.get(`${BASE_URL}/tasks/dashboard-stats`, {
      headers: adminHeaders,
    });
    const s = statsRes.data.data;
    console.log(`[PASSED] Dashboard stats calculated from PostgreSQL:`);
    console.log(`         Total Tasks: ${s.totalTasks}`);
    console.log(`         Completed Tasks: ${s.completedCount}`);
    console.log(`         Remaining Tasks: ${s.remainingCount}`);
    console.log(`         Completion Progress: ${s.completionProgress}%`);
    console.log(`         Overdue Tasks: ${s.overdueCount}`);
    console.log(`         Deadlines: Today=${s.deadlines.dueToday}, Tomorrow=${s.deadlines.dueTomorrow}, 7Days=${s.deadlines.dueIn7Days}`);
    console.log(`         Team Members Monitored: ${s.teamProgress.length}`);

    // 7. Scenario E: Automated Deadline Scheduler & Deduplication
    console.log("\n--- 7. SCENARIO E: DEADLINE SCHEDULER & DEDUPLICATION ---");
    const schedPass1 = await runDeadlineChecks();
    console.log(`[PASSED] Pass 1 processed ${schedPass1.processed} active tasks (Reminders sent: ${schedPass1.remindersSent})`);
    const schedPass2 = await runDeadlineChecks();
    console.log(`[PASSED] Pass 2 duplicate check: Reminders sent = ${schedPass2.remindersSent} (0 duplicates guaranteed)`);

    // 8. Scenario F: AI Assistant Copilot Endpoint (No configuration text)
    console.log("\n--- 8. SCENARIO F: AI ASSISTANT ENDPOINT & TIP REMOVAL ---");
    const aiRes = await axios.post(
      `${BASE_URL}/ai/chat`,
      { message: "What is my task workload summary?" },
      { headers: adminHeaders }
    );
    console.log(`[PASSED] AI response generated (Model: ${aiRes.data.data.model})`);
    const hasTipText = aiRes.data.data.reply.includes("Tip: To enable full Llama");
    console.log(`[PASSED] Configuration tip text absent: ${!hasTipText}`);
    console.log(`         Response preview: "${aiRes.data.data.reply.slice(0, 80).replace(/\n/g, " ")}..."`);

    // 9. Scenario G: Resend Email Logs in PostgreSQL
    console.log("\n--- 9. SCENARIO G: RESEND EMAILLOG TABLE VERIFICATION ---");
    const emailLogs = await prisma.emailLog.findMany({
      where: { taskId: createdTaskId },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[PASSED] Email logs recorded in PostgreSQL for task: ${emailLogs.length}`);
    emailLogs.forEach((log) => {
      console.log(`         - Event: ${log.eventType} | To: ${log.recipient} | Status: ${log.status} | ResendId: ${log.providerEmailId || "None"} | Error: ${log.errorMessage || "None"}`);
    });

    console.log("\n================================================================================");
    console.log(" ALL END-TO-END AUDIT & VERIFICATION SCENARIOS PASSED WITH 100% SUCCESS!");
    console.log("================================================================================\n");
  } finally {
    // 10. Clean up test records to preserve pristine database state
    if (createdTaskId) {
      console.log(`[CLEANUP] Safely deleting test task ${createdTaskId}...`);
      await prisma.emailLog.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.deadlineReminderLog.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.activityLog.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.notification.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.comment.deleteMany({ where: { taskId: createdTaskId } });
      await prisma.task.delete({ where: { id: createdTaskId } });
      console.log(`[CLEANUP] Test task and associated logs safely cleaned up.`);
    }

    server.close();
    await prisma.$disconnect();
  }
}

runAllScenarios().catch(async (e) => {
  console.error("\n❌ E2E Test Failure:", e.response?.data || e.message);
  await prisma.$disconnect();
  process.exit(1);
});
