import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";
import { Priority, Role, TaskStatus } from "@prisma/client";

async function main() {
  console.log("[Seed] Starting DeadlineHub database seed...");

  // Clean existing data
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.deadlineReminderLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("admin123", 10);
  const memberPasswordHash = await bcrypt.hash("member123", 10);

  // 1. Create Users
  const admin = await prisma.user.create({
    data: {
      email: "admin@deadlinehub.com",
      name: "Alex Mercer (Admin)",
      password: passwordHash,
      role: Role.ADMIN,
    },
  });

  const sarah = await prisma.user.create({
    data: {
      email: "sarah.jenkins@company.com",
      name: "Sarah Jenkins",
      password: memberPasswordHash,
      role: Role.MEMBER,
    },
  });

  const david = await prisma.user.create({
    data: {
      email: "david.chen@company.com",
      name: "David Chen",
      password: memberPasswordHash,
      role: Role.MEMBER,
    },
  });

  console.log(`[Seed] Created users: ${admin.email}, ${sarah.email}, ${david.email}`);

  const now = new Date();

  // Task 1: Urgent (45 minutes from now)
  const task1Deadline = new Date(now.getTime() + 45 * 60 * 1000);
  const task1 = await prisma.task.create({
    data: {
      title: "Implement OAuth2 SSO Integration for Enterprise Clients",
      description: "Finalize SAML and OAuth2 tokens flow, verify callback endpoints with client Okta instance.",
      jiraUrl: "https://jira.company.com/browse/CORE-104",
      assignedToId: sarah.id,
      assignedName: sarah.name,
      assignedEmail: sarah.email,
      createdById: admin.id,
      deadline: task1Deadline,
      priority: Priority.CRITICAL,
      status: TaskStatus.IN_PROGRESS,
    },
  });

  // Task 2: Warning (< 24h from now)
  const task2Deadline = new Date(now.getTime() + 18 * 60 * 60 * 1000);
  const task2 = await prisma.task.create({
    data: {
      title: "Database Indexing & Query Optimization for Task Feed",
      description: "Analyze slow queries on PostgreSQL task search, add composite index on (status, deadline).",
      jiraUrl: "https://jira.company.com/browse/CORE-142",
      assignedToId: david.id,
      assignedName: david.name,
      assignedEmail: david.email,
      createdById: admin.id,
      deadline: task2Deadline,
      priority: Priority.HIGH,
      status: TaskStatus.IN_PROGRESS,
    },
  });

  // Task 3: Normal Upcoming (3 days from now)
  const task3Deadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const task3 = await prisma.task.create({
    data: {
      title: "Security Headers & Rate Limiting Audit",
      description: "Review Helmet configuration and verify rate limiting against brute force attempts.",
      jiraUrl: "https://jira.company.com/browse/SEC-210",
      assignedToId: sarah.id,
      assignedName: sarah.name,
      assignedEmail: sarah.email,
      createdById: admin.id,
      deadline: task3Deadline,
      priority: Priority.MEDIUM,
      status: TaskStatus.TODO,
    },
  });

  // Task 4: External assignee without existing account (5 days from now)
  const task4Deadline = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const task4 = await prisma.task.create({
    data: {
      title: "Third-party Penetration Testing Review",
      description: "Review report from external security auditor and compile remediation items.",
      jiraUrl: "https://jira.company.com/browse/SEC-305",
      assignedToId: null,
      assignedName: "Elena Rostova",
      assignedEmail: "elena.contractor@partner.com",
      createdById: admin.id,
      deadline: task4Deadline,
      priority: Priority.HIGH,
      status: TaskStatus.TODO,
    },
  });

  // Task 5: Completed Task
  const task5Deadline = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const task5 = await prisma.task.create({
    data: {
      title: "Design System Tokens and Typography Updates",
      description: "Align color palette with modern slate/gray Linear aesthetics and verify contrast ratios.",
      jiraUrl: "https://jira.company.com/browse/DES-89",
      assignedToId: sarah.id,
      assignedName: sarah.name,
      assignedEmail: sarah.email,
      createdById: admin.id,
      deadline: task5Deadline,
      priority: Priority.LOW,
      status: TaskStatus.COMPLETED,
      completedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    },
  });

  // Task 6: Overdue Task (deadline 4 hours ago)
  const task6Deadline = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const task6 = await prisma.task.create({
    data: {
      title: "Patch SSL/TLS Cipher Suites on Production Balancer",
      description: "Disable legacy TLS 1.0/1.1 and update TLS ciphers to meet PCI-DSS compliance.",
      jiraUrl: "https://jira.company.com/browse/OPS-55",
      assignedToId: david.id,
      assignedName: david.name,
      assignedEmail: david.email,
      createdById: admin.id,
      deadline: task6Deadline,
      priority: Priority.CRITICAL,
      status: TaskStatus.IN_PROGRESS,
    },
  });

  console.log("[Seed] Created 6 tasks with various deadlines and states.");

  // Comments
  await prisma.comment.create({
    data: {
      taskId: task1.id,
      userId: sarah.id,
      content: "I have configured the Okta staging application. Starting end-to-end token validation now.",
    },
  });

  await prisma.comment.create({
    data: {
      taskId: task1.id,
      userId: admin.id,
      content: "Excellent. Let me know as soon as the staging smoke test passes so we can brief stakeholders.",
    },
  });

  await prisma.comment.create({
    data: {
      taskId: task2.id,
      userId: david.id,
      content: "Explain analyze shows query time dropped from 420ms down to 18ms with the new partial index.",
    },
  });

  // Notifications
  await prisma.notification.create({
    data: {
      userId: sarah.id,
      taskId: task1.id,
      type: "DEADLINE_REMINDER",
      message: 'Deadline reminder: "Implement OAuth2 SSO Integration for Enterprise Clients" is due in 45 minutes!',
    },
  });

  await prisma.notification.create({
    data: {
      userId: david.id,
      taskId: task6.id,
      type: "TASK_OVERDUE",
      message: 'Task Overdue: "Patch SSL/TLS Cipher Suites on Production Balancer" has passed its deadline!',
    },
  });

  // Activity Logs
  await prisma.activityLog.create({
    data: {
      taskId: task1.id,
      userId: admin.id,
      activityType: "Task Created",
      description: `Task "${task1.title}" created by ${admin.name}`,
    },
  });

  await prisma.activityLog.create({
    data: {
      taskId: task1.id,
      userId: admin.id,
      activityType: "Task Assigned",
      description: `Assigned to ${sarah.name} (${sarah.email})`,
    },
  });

  await prisma.activityLog.create({
    data: {
      taskId: task1.id,
      userId: sarah.id,
      activityType: "Status Changed",
      description: "Status changed from TODO to IN_PROGRESS",
    },
  });

  console.log("[Seed] Database seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("[Seed] Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
