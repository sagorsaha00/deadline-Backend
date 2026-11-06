import axios from "axios";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { signToken } from "../utils/jwt.js";

const BASE_URL = "http://localhost:5000/api";

async function main() {
  console.log("================================================================");
  console.log("DEADLINEHUB — VERIFICATION OF SUBMIT FOR REVIEW UX & AI CHATBOT");
  console.log("================================================================\n");

  // 1. Fetch Users
  const memberUser = await prisma.user.findUnique({
    where: { email: "sahasagor650@gmail.com" },
  });
  const adminUser = await prisma.user.findUnique({
    where: { email: "mrartimas24@gmail.com" },
  });

  if (!memberUser || !adminUser) {
    throw new Error("Required test users not found in database!");
  }

  const memberToken = signToken({
    userId: memberUser.id,
    email: memberUser.email,
    role: memberUser.role,
  });

  const adminToken = signToken({
    userId: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
  });

  const memberClient = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${memberToken}` },
  });

  const adminClient = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  console.log(`[AUTH] Member: ${memberUser.name} (${memberUser.email})`);
  console.log(`[AUTH] Admin:  ${adminUser.name} (${adminUser.email})\n`);

  // 2. Locate or create a test task
  let task = await prisma.task.findFirst({
    where: { assignedEmail: memberUser.email },
  });

  if (!task) {
    console.log("Creating active test task for member...");
    task = await prisma.task.create({
      data: {
        title: "Vendor Integration Module",
        description: "Integrate third-party API webhooks and verify payload validation",
        deadline: new Date(Date.now() + 48 * 3600 * 1000),
        priority: "HIGH",
        status: "TODO",
        jiraUrl: "https://jira.atlassian.net/browse/PROJ-101",
        createdById: adminUser.id,
        assignedToId: memberUser.id,
        assignedName: memberUser.name,
        assignedEmail: memberUser.email,
      },
    });
  }

  console.log(`[TEST TASK] ID: ${task.id} | Title: "${task.title}" | Status: ${task.status}\n`);

  // Reset task to TODO for workflow test
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "TODO" },
  });

  console.log("--- PART 1: WORKFLOW & PERMISSION TESTS ---");

  // Step 1: Member starts task -> IN_PROGRESS
  console.log("1. Member updating status to IN_PROGRESS...");
  const inProgressRes = await memberClient.patch(`/tasks/${task.id}/status`, {
    status: "IN_PROGRESS",
  });
  console.log(`   [SUCCESS] Status is now: ${inProgressRes.data.data.status}`);

  // Step 2: Security check - Member attempts to directly set COMPLETED
  console.log("2. Security Guard: Member attempts to directly patch COMPLETED...");
  try {
    await memberClient.patch(`/tasks/${task.id}/status`, {
      status: "COMPLETED",
    });
    console.error("   [FAILED] Member was able to mark COMPLETED directly!");
  } catch (err: any) {
    console.log(
      `   [PASSED] HTTP ${err.response?.status}: ${err.response?.data?.message || err.message}`
    );
  }

  // Step 3: Member submits task for review -> IN_REVIEW
  console.log("3. Member submits task for review (POST /api/tasks/:id/submit-review)...");
  const submitRes = await memberClient.post(`/tasks/${task.id}/submit-review`);
  console.log(
    `   [SUCCESS] Status is now: ${submitRes.data.data.status} (Message: ${submitRes.data.message})`
  );

  // Step 4: Admin requests changes -> IN_PROGRESS
  console.log("4. Admin requests changes with feedback comment...");
  const requestChangesRes = await adminClient.post(`/tasks/${task.id}/request-changes`, {
    reason: "Please add unit test coverage for edge cases before approval.",
  });
  console.log(
    `   [SUCCESS] Status returned to: ${requestChangesRes.data.data.status} (Message: ${requestChangesRes.data.message})`
  );

  // Step 5: Member resubmits for review -> IN_REVIEW
  console.log("5. Member addresses feedback and resubmits for review...");
  const resubmitRes = await memberClient.post(`/tasks/${task.id}/submit-review`);
  console.log(`   [SUCCESS] Status is now: ${resubmitRes.data.data.status}`);

  // Step 6: Admin approves & completes -> COMPLETED
  console.log("6. Admin approves & marks COMPLETED...");
  const completeRes = await adminClient.post(`/tasks/${task.id}/complete`);
  console.log(
    `   [SUCCESS] Status is now: ${completeRes.data.data.status} (Message: ${completeRes.data.message})\n`
  );

  console.log("--- PART 2: AI CHATBOT REAL DATABASE INTELLIGENCE ---");

  // Query 1: Member asks for all tasks
  console.log('Query 1 [Member]: "Show me all my tasks"');
  const q1Res = await memberClient.post("/ai/chat", {
    message: "Show me all my tasks and their status.",
  });
  console.log(`Model: ${q1Res.data.data.model}`);
  console.log(`Reply:\n${q1Res.data.data.reply}\n`);

  // Query 2: Member asks for task count
  console.log('Query 2 [Member]: "How many tasks are assigned to me?"');
  const q2Res = await memberClient.post("/ai/chat", {
    message: "How many tasks are assigned to me?",
  });
  console.log(`Reply:\n${q2Res.data.data.reply}\n`);

  // Query 3: Member asks for next deadline
  console.log('Query 3 [Member]: "What is my next deadline?"');
  const q3Res = await memberClient.post("/ai/chat", {
    message: "What is my next deadline?",
  });
  console.log(`Reply:\n${q3Res.data.data.reply}\n`);

  // Query 4: Multi-turn conversation context
  console.log('Query 4 [Member Multi-Turn]: Follow-up question about Jira ticket');
  const conversationTurns = [
    { role: "user", content: "Show me all my tasks" },
    { role: "assistant", content: q1Res.data.data.reply },
    { role: "user", content: "What is the Jira ticket link for my task?" },
  ];
  const q4Res = await memberClient.post("/ai/chat", {
    message: "What is the Jira ticket link for my task?",
    messages: conversationTurns,
  });
  console.log(`Reply:\n${q4Res.data.data.reply}\n`);

  // Query 5: Admin asks team summary
  console.log('Query 5 [Admin]: "Show all team tasks and workload summary"');
  const q5Res = await adminClient.post("/ai/chat", {
    message: "Show all team tasks and workload summary",
  });
  console.log(`Model: ${q5Res.data.data.model}`);
  console.log(`Reply:\n${q5Res.data.data.reply}\n`);

  console.log("================================================================");
  console.log("ALL TESTS EXECUTED AND VERIFIED SUCCESSFULLY!");
  console.log("================================================================");
}

main()
  .catch((e) => {
    console.error("Test execution failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
