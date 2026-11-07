import { prisma } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import axios from "axios";

const API_BASE = "http://localhost:5000/api";

async function runVerification() {
  console.log("=================================================");
  console.log("   DEADLINEHUB ASSIGNMENT & AUTH VERIFICATION    ");
  console.log("=================================================\n");

  const results: { test: string; status: "PASS" | "FAIL"; details: string }[] = [];

  // 1. Verify Existing Accounts & Preservation
  console.log("Step 1: Checking Existing Accounts Preservation...");
  const adminUser = await prisma.user.findUnique({ where: { email: "mrartimas24@gmail.com" } });
  const member1 = await prisma.user.findUnique({ where: { email: "sahasagor650@gmail.com" } });
  const member2 = await prisma.user.findUnique({ where: { email: "md.anis.molla009@gmail.com" } });

  if (!adminUser || adminUser.role !== "ADMIN") {
    results.push({ test: "Preservation - Admin", status: "FAIL", details: "Admin user not found or role corrupted" });
  } else {
    results.push({ test: "Preservation - Admin", status: "PASS", details: `Admin preserved: ${adminUser.email} (Role: ${adminUser.role})` });
  }

  if (!member1 || member1.role !== "MEMBER" || !member2 || member2.role !== "MEMBER") {
    results.push({ test: "Preservation - Members", status: "FAIL", details: "Members not found or roles corrupted" });
  } else {
    results.push({ test: "Preservation - Members", status: "PASS", details: `Members preserved: ${member1.email}, ${member2.email} (Role: MEMBER)` });
  }

  // Generate valid session tokens for Admin and Member1
  const adminToken = adminUser ? signToken({ userId: adminUser.id, email: adminUser.email, role: adminUser.role }) : "";
  const member1Token = member1 ? signToken({ userId: member1.id, email: member1.email, role: member1.role }) : "";
  console.log("✓ Tokens issued for testing API endpoints");

  // 2. Security Test A: Normal Registration -> MEMBER
  console.log("\nStep 2: Security Test A - Normal Registration...");
  const normalEmail = `member_test_${Date.now()}@example.com`;
  try {
    const regRes = await axios.post(`${API_BASE}/auth/register`, {
      name: "Normal Member",
      email: normalEmail,
      password: "Password123!",
    });
    const createdUser = await prisma.user.findUnique({ where: { email: normalEmail } });
    if (createdUser && createdUser.role === "MEMBER") {
      results.push({ test: "Security Test A: Normal Registration", status: "PASS", details: `Created with role: ${createdUser.role}` });
    } else {
      results.push({ test: "Security Test A: Normal Registration", status: "FAIL", details: `Unexpected role: ${createdUser?.role}` });
    }
  } catch (err: any) {
    results.push({ test: "Security Test A: Normal Registration", status: "FAIL", details: err.response?.data?.message || err.message });
  }

  // 3. Security Test B: Forged ADMIN in registration -> Must still be MEMBER
  console.log("\nStep 3: Security Test B - Forged ADMIN in registration...");
  const forgedAdminEmail = `forged_admin_${Date.now()}@example.com`;
  try {
    await axios.post(`${API_BASE}/auth/register`, {
      name: "Attacker Admin",
      email: forgedAdminEmail,
      password: "Password123!",
      role: "ADMIN",
    });
    const createdUser = await prisma.user.findUnique({ where: { email: forgedAdminEmail } });
    if (createdUser && createdUser.role === "MEMBER") {
      results.push({ test: "Security Test B: Forged ADMIN Registration", status: "PASS", details: `Ignored forged role; actual role: ${createdUser.role}` });
    } else {
      results.push({ test: "Security Test B: Forged ADMIN Registration", status: "FAIL", details: `Privilege escalation succeeded! Role: ${createdUser?.role}` });
    }
  } catch (err: any) {
    results.push({ test: "Security Test B: Forged ADMIN Registration", status: "FAIL", details: err.response?.data?.message || err.message });
  }

  // 4. Security Test C: Forged SUPER_ADMIN in registration -> Must still be MEMBER
  console.log("\nStep 4: Security Test C - Forged SUPER_ADMIN in registration...");
  const forgedSuperEmail = `forged_super_${Date.now()}@example.com`;
  try {
    await axios.post(`${API_BASE}/auth/register`, {
      name: "Attacker SuperAdmin",
      email: forgedSuperEmail,
      password: "Password123!",
      role: "SUPER_ADMIN",
    });
    const createdUser = await prisma.user.findUnique({ where: { email: forgedSuperEmail } });
    if (createdUser && createdUser.role === "MEMBER") {
      results.push({ test: "Security Test C: Forged SUPER_ADMIN Registration", status: "PASS", details: `Ignored forged role; actual role: ${createdUser.role}` });
    } else {
      results.push({ test: "Security Test C: Forged SUPER_ADMIN Registration", status: "FAIL", details: `Privilege escalation succeeded! Role: ${createdUser?.role}` });
    }
  } catch (err: any) {
    results.push({ test: "Security Test C: Forged SUPER_ADMIN Registration", status: "FAIL", details: err.response?.data?.message || err.message });
  }

  // 5. Security Test D: Self-role escalation via PATCH /profile -> Must return 403 Forbidden
  console.log("\nStep 5: Security Test D - Member self-role escalation via profile update...");
  try {
    await axios.patch(
      `${API_BASE}/users/profile`,
      { name: "Sneaky Member", role: "ADMIN" },
      { headers: { Authorization: `Bearer ${member1Token}` } }
    );
    results.push({ test: "Security Test D: Self-Role Escalation Blocked", status: "FAIL", details: "Server allowed role change on /profile!" });
  } catch (err: any) {
    if (err.response?.status === 403) {
      results.push({
        test: "Security Test D: Self-Role Escalation Blocked",
        status: "PASS",
        details: `Server correctly returned HTTP 403: "${err.response?.data?.message}"`,
      });
    } else {
      results.push({
        test: "Security Test D: Self-Role Escalation Blocked",
        status: "FAIL",
        details: `Unexpected HTTP status: ${err.response?.status}`,
      });
    }
  }

  // 6. Email Test 1: Admin creates task assigned to Member 1 (sahasagor650@gmail.com)
  console.log("\nStep 6: Email Test 1 - Admin assigns task to Member 1...");
  let createdTaskId = "";
  try {
    const initialEmailLogsCount = await prisma.emailLog.count();
    const taskTitle = `Test Verification Task ${Date.now()}`;
    const deadline = new Date(Date.now() + 86400000).toISOString();

    const taskRes = await axios.post(
      `${API_BASE}/tasks`,
      {
        title: taskTitle,
        description: "Comprehensive verification of email routing and notifications.",
        jiraUrl: "https://jira.example.com/browse/VERIFY-101",
        priority: "HIGH",
        assignedToId: member1!.id,
        assignedName: member1!.name,
        assignedEmail: member1!.email,
        deadline,
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    createdTaskId = taskRes.data.data.id;
    console.log(`✓ Task created with ID: ${createdTaskId}`);

    // Wait a brief moment for background async email logging
    await new Promise((r) => setTimeout(r, 1500));

    // Check in-app notification for Member 1
    const member1Notif = await prisma.notification.findFirst({
      where: {
        userId: member1!.id,
        taskId: createdTaskId,
        type: "TASK_ASSIGNED",
      },
      orderBy: { createdAt: "desc" },
    });

    // Check if Admin received any notification (Admin should NOT receive TASK_ASSIGNED)
    const adminNotif = await prisma.notification.findFirst({
      where: {
        userId: adminUser!.id,
        taskId: createdTaskId,
      },
    });

    // Check EmailLog for recipient
    const latestEmailLog = await prisma.emailLog.findFirst({
      where: {
        taskId: createdTaskId,
      },
      orderBy: { createdAt: "desc" },
    });

    const isMember1Notified = !!member1Notif && member1Notif.isRead === false;
    const adminDidNotGetNotif = !adminNotif;
    const emailRecipient = latestEmailLog?.recipient || latestEmailLog?.to;
    const emailRecipientCorrect = emailRecipient === member1!.email;
    const adminDidNotGetEmail = emailRecipient !== adminUser!.email;

    if (isMember1Notified && adminDidNotGetNotif && emailRecipientCorrect && adminDidNotGetEmail) {
      results.push({
        test: "Email Test 1: Task Assignment Recipient & In-App Notification",
        status: "PASS",
        details: `Email routed to ${emailRecipient} (Subject: "${latestEmailLog?.subject}"). Member in-app notif created (isRead: false). Admin received NO assignment email/notif.`,
      });
    } else {
      results.push({
        test: "Email Test 1: Task Assignment Recipient & In-App Notification",
        status: "FAIL",
        details: `member1Notif: ${!!member1Notif}, adminNotif: ${!!adminNotif}, emailRecipient: ${emailRecipient}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "Email Test 1: Task Assignment Recipient & In-App Notification",
      status: "FAIL",
      details: err.response?.data?.message || err.message,
    });
  }

  // 7. Email Test 2: Reassign task to Member 2 (md.anis.molla009@gmail.com)
  console.log("\nStep 7: Email Test 2 - Reassign task to Member 2...");
  try {
    await axios.patch(
      `${API_BASE}/tasks/${createdTaskId}`,
      {
        assignedToId: member2!.id,
        assignedName: member2!.name,
        assignedEmail: member2!.email,
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    await new Promise((r) => setTimeout(r, 1500));

    // Member 2 should have TASK_ASSIGNED
    const member2Notif = await prisma.notification.findFirst({
      where: {
        userId: member2!.id,
        taskId: createdTaskId,
        type: "TASK_ASSIGNED",
      },
    });

    // Member 1 should have TASK_REASSIGNED
    const member1ReassignedNotif = await prisma.notification.findFirst({
      where: {
        userId: member1!.id,
        taskId: createdTaskId,
        type: "TASK_REASSIGNED",
      },
    });

    // EmailLog should show email to Member 2
    const reassignedEmailLog = await prisma.emailLog.findFirst({
      where: {
        taskId: createdTaskId,
        OR: [
          { recipient: member2!.email },
          { to: member2!.email },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (member2Notif && member1ReassignedNotif && reassignedEmailLog) {
      const recipient = reassignedEmailLog.recipient || reassignedEmailLog.to;
      results.push({
        test: "Email Test 2: Task Reassignment",
        status: "PASS",
        details: `Member 2 received assignment email (${recipient}) & TASK_ASSIGNED notif. Member 1 received TASK_REASSIGNED notif.`,
      });
    } else {
      results.push({
        test: "Email Test 2: Task Reassignment",
        status: "FAIL",
        details: `member2Notif: ${!!member2Notif}, member1ReassignedNotif: ${!!member1ReassignedNotif}, reassignedEmailLog: ${!!reassignedEmailLog}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "Email Test 2: Task Reassignment",
      status: "FAIL",
      details: err.response?.data?.message || err.message,
    });
  }

  // 8. Email Test 3: Edit Task without Changing Assignee -> No Email Sent
  console.log("\nStep 8: Email Test 3 - Edit task without changing assignee...");
  try {
    const logsBefore = await prisma.emailLog.count();

    await axios.patch(
      `${API_BASE}/tasks/${createdTaskId}`,
      {
        description: "Updated description without changing assignee.",
        priority: "CRITICAL",
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    await new Promise((r) => setTimeout(r, 1000));
    const logsAfter = await prisma.emailLog.count();

    if (logsBefore === logsAfter) {
      results.push({
        test: "Email Test 3: Edit Without Reassignment (No Duplicate Email)",
        status: "PASS",
        details: "No new assignment email was generated when only description/priority were updated.",
      });
    } else {
      results.push({
        test: "Email Test 3: Edit Without Reassignment (No Duplicate Email)",
        status: "FAIL",
        details: `Email logs increased by ${logsAfter - logsBefore}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "Email Test 3: Edit Without Reassignment (No Duplicate Email)",
      status: "FAIL",
      details: err.response?.data?.message || err.message,
    });
  }

  // Summary
  console.log("\n=================================================");
  console.log("               VERIFICATION RESULTS              ");
  console.log("=================================================");
  let passedCount = 0;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} [${r.status}] ${r.test}`);
    console.log(`   └─ ${r.details}`);
    if (r.status === "PASS") passedCount++;
  }
  console.log(`\nTOTAL: ${passedCount}/${results.length} PASSED`);
}

runVerification()
  .catch((e) => console.error("Verification error:", e))
  .finally(() => prisma.$disconnect());
