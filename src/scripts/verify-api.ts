import axios from "axios";
import { prisma } from "../config/db.js";

const API_BASE = "http://localhost:5000/api";

async function runApiVerification() {
  console.log("=== Starting DeadlineHub Complete Upgrade Verification ===\n");

  let adminToken = "";
  let memberToken = "";
  let createdTaskId = "";

  // 1. Health check
  console.log("1. Testing Health Endpoint...");
  const healthRes = await axios.get("http://localhost:5000/health");
  console.log("   Health response:", healthRes.data);
  if (!healthRes.data.success) throw new Error("Health check failed");

  // 2. Login as Admin
  console.log("\n2. Testing Admin Login...");
  const adminLoginRes = await axios.post(`${API_BASE}/auth/login`, {
    email: "admin@deadlinehub.com",
    password: "admin123",
  });
  adminToken = adminLoginRes.data.data.token;
  console.log("   Admin login status:", adminLoginRes.status, `User: ${adminLoginRes.data.data.user.name}`);
  if (!adminToken) throw new Error("Admin login failed");

  // 3. Login as Member
  console.log("\n3. Testing Member Login...");
  const memberLoginRes = await axios.post(`${API_BASE}/auth/login`, {
    email: "sarah.jenkins@company.com",
    password: "member123",
  });
  memberToken = memberLoginRes.data.data.token;
  console.log("   Member login status:", memberLoginRes.status, `User: ${memberLoginRes.data.data.user.name}`);
  if (!memberToken) throw new Error("Member login failed");

  // 4. Create Task as Admin
  console.log("\n4. Testing Task Creation (Admin)...");
  const taskDeadline = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const createTaskRes = await axios.post(
    `${API_BASE}/tasks`,
    {
      title: "Resend & Workflow Live Verification Task",
      description: "Testing strict review workflow, Resend emails, and AI copilot.",
      jiraUrl: "https://jira.company.com/browse/VERIFY-101",
      assignedName: "Sarah Jenkins",
      assignedEmail: "sarah.jenkins@company.com",
      deadline: taskDeadline,
      priority: "HIGH",
    },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  createdTaskId = createTaskRes.data.data.id;
  console.log(`   [PASSED] Task created: "${createTaskRes.data.data.title}" (ID: ${createdTaskId})`);

  // 5. Member attempts to mark task COMPLETED (STRICT GUARD: Must be 403 Forbidden)
  console.log("\n5. Testing Strict Status Guard: Member attempting to mark task COMPLETED...");
  try {
    await axios.patch(
      `${API_BASE}/tasks/${createdTaskId}/status`,
      { status: "COMPLETED" },
      { headers: { Authorization: `Bearer ${memberToken}` } }
    );
    throw new Error("SECURITY FAILURE: Member was able to mark task COMPLETED!");
  } catch (err: any) {
    if (err.response?.status === 403) {
      console.log(`   [PASSED] HTTP 403 Forbidden correctly returned: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }

  // 6. Member updates task to IN_PROGRESS
  console.log("\n6. Testing Permitted Member Status Update to IN_PROGRESS...");
  const inProgressRes = await axios.patch(
    `${API_BASE}/tasks/${createdTaskId}/status`,
    { status: "IN_PROGRESS" },
    { headers: { Authorization: `Bearer ${memberToken}` } }
  );
  console.log(`   [PASSED] Status updated to: ${inProgressRes.data.data.status}`);

  // 7. Member submits task for review (POST /api/tasks/:id/submit-review)
  console.log("\n7. Testing Submit for Review (Member)...");
  const submitReviewRes = await axios.post(
    `${API_BASE}/tasks/${createdTaskId}/submit-review`,
    {},
    { headers: { Authorization: `Bearer ${memberToken}` } }
  );
  console.log(`   [PASSED] Task moved to: ${submitReviewRes.data.data.status}`);

  // 8. Admin requests changes on the submitted task
  console.log("\n8. Testing Admin Request Changes (moves IN_REVIEW -> IN_PROGRESS)...");
  const requestChangesRes = await axios.post(
    `${API_BASE}/tasks/${createdTaskId}/request-changes`,
    { reason: "Please attach unit test coverage logs." },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  console.log(`   [PASSED] Task status updated to: ${requestChangesRes.data.data.status}`);

  // 9. Member re-submits for review
  console.log("\n9. Testing Member Re-submitting for Review...");
  const resubmitRes = await axios.post(
    `${API_BASE}/tasks/${createdTaskId}/submit-review`,
    {},
    { headers: { Authorization: `Bearer ${memberToken}` } }
  );
  console.log(`   [PASSED] Task re-submitted to: ${resubmitRes.data.data.status}`);

  // 10. Admin approves and marks task COMPLETED (POST /api/tasks/:id/complete)
  console.log("\n10. Testing Admin Approval & Completion...");
  const completeRes = await axios.post(
    `${API_BASE}/tasks/${createdTaskId}/complete`,
    {},
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  console.log(`   [PASSED] Task approved and marked: ${completeRes.data.data.status}, completedAt: ${completeRes.data.data.completedAt}`);

  // 11. Admin sends manual deadline reminder on a task
  console.log("\n11. Testing Admin Manual Deadline Reminder (Resend email + notification)...");
  const remindRes = await axios.post(
    `${API_BASE}/tasks/${createdTaskId}/remind`,
    {},
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  console.log(`   [PASSED] Reminder response: ${remindRes.data.message}`);

  // 12. Testing AI Assistant Endpoint (/api/ai/chat)
  console.log("\n12. Testing AI Assistant Chat with Member Context...");
  const memberAiRes = await axios.post(
    `${API_BASE}/ai/chat`,
    { message: "What tasks do I have assigned?" },
    { headers: { Authorization: `Bearer ${memberToken}` } }
  );
  console.log(`   [PASSED] Member AI reply received (Model: ${memberAiRes.data.data.model}):`);
  console.log(`   Preview: "${memberAiRes.data.data.reply.slice(0, 100)}..."`);

  console.log("\n13. Testing AI Assistant Chat with Admin Context...");
  const adminAiRes = await axios.post(
    `${API_BASE}/ai/chat`,
    { message: "Give me an overview of the team's workload." },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  console.log(`   [PASSED] Admin AI reply received (Model: ${adminAiRes.data.data.model}):`);
  console.log(`   Preview: "${adminAiRes.data.data.reply.slice(0, 100)}..."`);

  // 14. Check PostgreSQL EmailLog table for Resend logs
  console.log("\n14. Verifying EmailLog Table in PostgreSQL...");
  const emailLogs = await prisma.emailLog.findMany({
    where: { taskId: createdTaskId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log(`   Found ${emailLogs.length} EmailLog records for task ${createdTaskId}:`);
  emailLogs.forEach((log) => {
    console.log(`   - [${log.provider}] Event: ${log.eventType}, To: ${log.recipient}, Status: ${log.status}`);
  });

  console.log("\n=======================================================");
  console.log(" ALL FULL-STACK DEADLINEHUB UPGRADE CHECKS PASSED!");
  console.log("=======================================================\n");

  await prisma.$disconnect();
}

runApiVerification().catch(async (err) => {
  console.error("\n❌ Verification Failed:", err.response?.data || err.message);
  await prisma.$disconnect();
  process.exit(1);
});
