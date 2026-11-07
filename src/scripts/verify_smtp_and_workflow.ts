import { prisma } from "../config/db.js";
import { signToken } from "../utils/jwt.js";
import { verifySmtpConnection, sendEmail } from "../modules/emails/emailService.js";
import { runDeadlineChecks } from "../jobs/deadlineScheduler.js";
import axios from "axios";
import nodemailer from "nodemailer";

const API_BASE = "http://localhost:5000/api";

async function runComprehensiveVerification() {
  console.log("=================================================");
  console.log("   DEADLINEHUB GMAIL SMTP & WORKFLOW AUDIT       ");
  console.log("=================================================\n");

  const results: { test: string; status: "PASS" | "FAIL"; details: string }[] = [];

  // 1. Verify Gmail SMTP Connection
  console.log("Step 1: Testing Gmail SMTP Handshake & Authentication...");
  const connStatus = await verifySmtpConnection();
  if (connStatus.success) {
    results.push({
      test: "1. Gmail SMTP Connection Handshake",
      status: "PASS",
      details: connStatus.message,
    });
  } else {
    results.push({
      test: "1. Gmail SMTP Connection Handshake",
      status: "FAIL",
      details: connStatus.message,
    });
  }

  // 2. Test Invalid SMTP Credentials & Error Handling
  console.log("\nStep 2: Testing Invalid SMTP Credentials Error Handling...");
  try {
    const invalidTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: "invalid_user_test@gmail.com",
        pass: "badpassword1234",
      },
    });
    let rejected = false;
    try {
      await invalidTransporter.verify();
    } catch (err: any) {
      rejected = true;
      const safeMsg = err.message || "";
      const passwordLeaked = safeMsg.includes("badpassword1234");
      if (rejected && !passwordLeaked) {
        results.push({
          test: "2. SMTP Invalid Credentials Error Handling",
          status: "PASS",
          details: `Transporter rejected bad credentials gracefully without leaking password (${safeMsg.slice(0, 70)}...)`,
        });
      } else {
        results.push({
          test: "2. SMTP Invalid Credentials Error Handling",
          status: "FAIL",
          details: `Password leak or unhandled error state. PasswordLeaked: ${passwordLeaked}`,
        });
      }
    }
    if (!rejected) {
      results.push({
        test: "2. SMTP Invalid Credentials Error Handling",
        status: "FAIL",
        details: "Expected invalid credentials to be rejected, but verify() succeeded.",
      });
    }
  } catch (e: any) {
    results.push({
      test: "2. SMTP Invalid Credentials Error Handling",
      status: "FAIL",
      details: e.message,
    });
  }

  // 3. Direct Test Email Delivery
  console.log("\nStep 3: Sending Direct Test Email via Gmail SMTP...");
  const testRecipient = "sagorsahadev00@gmail.com";
  const directSent = await sendEmail({
    to: testRecipient,
    subject: `[DeadlineHub] SMTP Verification Test ${Date.now()}`,
    html: `
      <h2>DeadlineHub Gmail SMTP Active</h2>
      <p>This is a live verification email sent from DeadlineHub via Gmail SMTP (sagorsahadev00@gmail.com).</p>
      <p>Timestamp: ${new Date().toISOString()}</p>
    `,
    eventType: "DIRECT_TEST",
  });

  const directLog = await prisma.emailLog.findFirst({
    where: {
      recipient: testRecipient,
      eventType: "DIRECT_TEST",
    },
    orderBy: { createdAt: "desc" },
  });

  if (directSent && directLog && directLog.status === "SENT" && directLog.provider === "GMAIL_SMTP") {
    results.push({
      test: "3. Direct Test Email Delivery",
      status: "PASS",
      details: `Delivered to ${testRecipient}. Status: ${directLog.status}, Provider: ${directLog.provider}, MessageId: ${directLog.providerEmailId}`,
    });
  } else {
    results.push({
      test: "3. Direct Test Email Delivery",
      status: "FAIL",
      details: `directSent: ${directSent}, log: ${JSON.stringify(directLog)}`,
    });
  }

  // Find Admin and Members in PostgreSQL
  const adminUser = await prisma.user.findUnique({ where: { email: "mrartimas24@gmail.com" } });
  const member1 = await prisma.user.findUnique({ where: { email: "sahasagor650@gmail.com" } });
  const member2 = await prisma.user.findUnique({ where: { email: "md.anis.molla009@gmail.com" } });

  if (!adminUser || !member1 || !member2) {
    console.error("Required user accounts missing from PostgreSQL");
    return;
  }

  const adminToken = signToken({ userId: adminUser.id, email: adminUser.email, role: adminUser.role });

  // 4. Task Assignment Email Test
  console.log("\nStep 4: Admin Assigns Task to Member 1 (sahasagor650@gmail.com)...");
  let createdTaskId = "";
  try {
    const taskTitle = `Gmail SMTP Verification Task ${Date.now()}`;
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hours from now

    const taskRes = await axios.post(
      `${API_BASE}/tasks`,
      {
        title: taskTitle,
        description: "Validating Gmail SMTP assignment routing and in-app notifications.",
        jiraUrl: "https://jira.company.com/browse/SMTP-101",
        priority: "HIGH",
        assignedToId: member1.id,
        assignedName: member1.name,
        assignedEmail: member1.email,
        deadline,
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    createdTaskId = taskRes.data.data.id;
    console.log(`✓ Task created with ID: ${createdTaskId}`);

    // Wait 3.5 seconds for async email dispatch
    await new Promise((r) => setTimeout(r, 3500));

    // Check in-app notification for Member 1
    const member1Notif = await prisma.notification.findFirst({
      where: {
        userId: member1.id,
        taskId: createdTaskId,
        type: "TASK_ASSIGNED",
      },
      orderBy: { createdAt: "desc" },
    });

    // Check that Admin received NO assignment notification
    const adminNotif = await prisma.notification.findFirst({
      where: {
        userId: adminUser.id,
        taskId: createdTaskId,
        type: "TASK_ASSIGNED",
      },
    });

    // Check EmailLog for recipient and provider
    const assignmentEmailLog = await prisma.emailLog.findFirst({
      where: {
        taskId: createdTaskId,
        eventType: "TASK_ASSIGNED",
      },
      orderBy: { createdAt: "desc" },
    });

    const isMember1Notified = !!member1Notif && member1Notif.isRead === false;
    const adminNotSpammed = !adminNotif;
    const recipientMatchesMember = assignmentEmailLog && (assignmentEmailLog.recipient === member1.email || assignmentEmailLog.to === member1.email);
    const providerIsSmtp = assignmentEmailLog?.provider === "GMAIL_SMTP";
    const statusIsSent = assignmentEmailLog?.status === "SENT";

    if (isMember1Notified && adminNotSpammed && recipientMatchesMember && providerIsSmtp && statusIsSent) {
      results.push({
        test: "4. Task Assignment Email (Recipient, In-App, Admin Excluded)",
        status: "PASS",
        details: `Sent via Gmail SMTP to member ${assignmentEmailLog?.recipient}. In-app notification created (isRead: false). Admin excluded from assignment email. MessageId: ${assignmentEmailLog?.providerEmailId}`,
      });
    } else {
      results.push({
        test: "4. Task Assignment Email (Recipient, In-App, Admin Excluded)",
        status: "FAIL",
        details: `member1Notif: ${!!member1Notif}, adminNotif: ${!!adminNotif}, recipient: ${assignmentEmailLog?.recipient}, provider: ${assignmentEmailLog?.provider}, status: ${assignmentEmailLog?.status}, error: ${assignmentEmailLog?.errorMessage}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "4. Task Assignment Email (Recipient, In-App, Admin Excluded)",
      status: "FAIL",
      details: err.response?.data?.message || err.message,
    });
  }

  // 5. Task Reassignment Test
  console.log("\nStep 5: Admin Reassigns Task to Member 2 (md.anis.molla009@gmail.com)...");
  try {
    await axios.patch(
      `${API_BASE}/tasks/${createdTaskId}`,
      {
        assignedToId: member2.id,
        assignedName: member2.name,
        assignedEmail: member2.email,
      },
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    await new Promise((r) => setTimeout(r, 3500));

    // Member 2 receives TASK_ASSIGNED
    const member2Notif = await prisma.notification.findFirst({
      where: {
        userId: member2.id,
        taskId: createdTaskId,
        type: "TASK_ASSIGNED",
      },
    });

    // Member 1 receives TASK_REASSIGNED
    const member1ReassignedNotif = await prisma.notification.findFirst({
      where: {
        userId: member1.id,
        taskId: createdTaskId,
        type: "TASK_REASSIGNED",
      },
    });

    // EmailLog should record email to Member 2
    const reassignedEmailLog = await prisma.emailLog.findFirst({
      where: {
        taskId: createdTaskId,
        OR: [
          { recipient: member2.email },
          { to: member2.email },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (member2Notif && member1ReassignedNotif && reassignedEmailLog && reassignedEmailLog.status === "SENT") {
      results.push({
        test: "5. Task Reassignment Workflow",
        status: "PASS",
        details: `Member 2 received assignment email (${reassignedEmailLog.recipient}) & in-app notif. Member 1 received TASK_REASSIGNED. MessageId: ${reassignedEmailLog.providerEmailId}`,
      });
    } else {
      results.push({
        test: "5. Task Reassignment Workflow",
        status: "FAIL",
        details: `member2Notif: ${!!member2Notif}, member1ReassignedNotif: ${!!member1ReassignedNotif}, status: ${reassignedEmailLog?.status}, error: ${reassignedEmailLog?.errorMessage}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "5. Task Reassignment Workflow",
      status: "FAIL",
      details: err.response?.data?.message || err.message,
    });
  }

  // 6. Deadline Scheduler & Reminder Email Test
  console.log("\nStep 6: Testing Deadline Reminder Scheduler & Duplicate Prevention...");
  try {
    // Update task deadline to 45 minutes from now (falls into 1_HOUR urgency window)
    await prisma.task.update({
      where: { id: createdTaskId },
      data: {
        deadline: new Date(Date.now() + 45 * 60 * 1000),
      },
    });

    // Run scheduler check iteration 1
    const run1 = await runDeadlineChecks();
    console.log(`   Scheduler Iteration 1: processed ${run1.processed}, remindersSent: ${run1.remindersSent}`);

    // Wait 2.5 seconds for async emails
    await new Promise((r) => setTimeout(r, 2500));

    // Run scheduler check iteration 2 immediately
    const run2 = await runDeadlineChecks();
    console.log(`   Scheduler Iteration 2: processed ${run2.processed}, remindersSent: ${run2.remindersSent}`);

    // Verify reminder log exists in deadlineReminderLog and emailLog
    const reminderLog = await prisma.deadlineReminderLog.findFirst({
      where: {
        taskId: createdTaskId,
        reminderType: "1_HOUR",
      },
    });

    const reminderEmailLog = await prisma.emailLog.findFirst({
      where: {
        taskId: createdTaskId,
        eventType: "DEADLINE_REMINDER_1_HOUR",
      },
    });

    const reminderSentOnce = run1.remindersSent >= 1;
    const duplicateBlockedOnSecondRun = run2.remindersSent === 0;

    if (reminderLog && reminderEmailLog && reminderSentOnce && duplicateBlockedOnSecondRun) {
      results.push({
        test: "6. Deadline Reminder & Duplicate Prevention",
        status: "PASS",
        details: `Reminder dispatched via Gmail SMTP to assignee. Idempotency lock claimed successfully. Second scheduler run safely blocked duplicate (remindersSent: 0).`,
      });
    } else {
      results.push({
        test: "6. Deadline Reminder & Duplicate Prevention",
        status: "FAIL",
        details: `run1Sent: ${run1.remindersSent}, run2Sent: ${run2.remindersSent}, reminderLog: ${!!reminderLog}, emailLog: ${!!reminderEmailLog}`,
      });
    }
  } catch (err: any) {
    results.push({
      test: "6. Deadline Reminder & Duplicate Prevention",
      status: "FAIL",
      details: err.message,
    });
  }

  // Wait 3.5 seconds before cleanup so background emails finish recording
  await new Promise((r) => setTimeout(r, 3500));

  // Cleanup test task
  if (createdTaskId) {
    await prisma.deadlineReminderLog.deleteMany({ where: { taskId: createdTaskId } });
    await prisma.notification.deleteMany({ where: { taskId: createdTaskId } });
    await prisma.activityLog.deleteMany({ where: { taskId: createdTaskId } });
    await prisma.emailLog.deleteMany({ where: { taskId: createdTaskId } });
    await prisma.task.delete({ where: { id: createdTaskId } });
    console.log("\n✓ Cleaned up test task from PostgreSQL");
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

runComprehensiveVerification()
  .catch((e) => console.error("Verification error:", e))
  .finally(() => prisma.$disconnect());
