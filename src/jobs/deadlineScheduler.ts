import cron from "node-cron";
import { prisma } from "../config/db.js";
import { TaskStatus } from "@prisma/client";
import { sendResendEmail } from "../modules/emails/resendService.js";
import {
  deadlineReminderTemplate,
  taskOverdueTemplate,
} from "../modules/emails/resendTemplates.js";
import { env } from "../config/env.js";

const REMINDER_TYPES = {
  THREE_DAYS: "3_DAYS",
  ONE_DAY: "1_DAY",
  ONE_HOUR: "1_HOUR",
  OVERDUE: "OVERDUE",
} as const;

/**
 * Executes a single deadline check iteration.
 * Can be called manually in tests or automatically by cron.
 */
export async function runDeadlineChecks(): Promise<{
  processed: number;
  remindersSent: number;
  overdueSent: number;
}> {
  const now = new Date();
  let remindersSent = 0;
  let overdueSent = 0;

  try {
    // 1. Fetch non-completed tasks
    const activeTasks = await prisma.task.findMany({
      where: {
        status: { notIn: [TaskStatus.COMPLETED] },
      },
      include: {
        createdBy: true,
        assignedTo: true,
        reminders: true,
      },
    });

    for (const task of activeTasks) {
      const deadlineTime = new Date(task.deadline).getTime();
      const diffMs = deadlineTime - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      const existingReminderTypes = new Set(task.reminders.map((r) => r.reminderType));

      // Overdue check
      if (diffMs < 0) {
        if (!existingReminderTypes.has(REMINDER_TYPES.OVERDUE)) {
          const claimed = await claimReminder(task.id, REMINDER_TYPES.OVERDUE);
          if (claimed) {
            overdueSent++;
            await processOverdueNotification(task);
          }
        }
        continue;
      }

      // 1-Hour check (<= 1 hour remaining)
      if (diffHours <= 1) {
        if (!existingReminderTypes.has(REMINDER_TYPES.ONE_HOUR)) {
          const claimed = await claimReminder(task.id, REMINDER_TYPES.ONE_HOUR);
          if (claimed) {
            remindersSent++;
            await processDeadlineNotification(task, "1_HOUR", "1 hour");
          }
        }
        continue;
      }

      // 1-Day check (<= 24 hours remaining)
      if (diffHours <= 24) {
        if (!existingReminderTypes.has(REMINDER_TYPES.ONE_DAY)) {
          const claimed = await claimReminder(task.id, REMINDER_TYPES.ONE_DAY);
          if (claimed) {
            remindersSent++;
            await processDeadlineNotification(task, "1_DAY", "24 hours");
          }
        }
        continue;
      }

      // 3-Days check (<= 72 hours remaining)
      if (diffHours <= 72) {
        if (!existingReminderTypes.has(REMINDER_TYPES.THREE_DAYS)) {
          const claimed = await claimReminder(task.id, REMINDER_TYPES.THREE_DAYS);
          if (claimed) {
            remindersSent++;
            await processDeadlineNotification(task, "3_DAYS", "3 days");
          }
        }
      }
    }

    return { processed: activeTasks.length, remindersSent, overdueSent };
  } catch (error: any) {
    if (error?.code === "P1001" || error?.code === "P2024") {
      console.warn("[DeadlineScheduler] Database currently unreachable; will retry on next tick:", error.message);
    } else {
      console.error("[DeadlineScheduler] Error running deadline checks:", error.message || error);
    }
    return { processed: 0, remindersSent, overdueSent };
  }
}

/**
 * Concurrency-safe lock: Uses database unique constraint [taskId, reminderType]
 * to ensure that even across concurrent instances, only one worker can process each reminder.
 */
async function claimReminder(taskId: string, reminderType: string): Promise<boolean> {
  try {
    await prisma.deadlineReminderLog.create({
      data: {
        taskId,
        reminderType,
        sentAt: new Date(),
      },
    });
    return true;
  } catch (err: any) {
    // Unique constraint violation (P2002) means another process already claimed this reminder
    if (err.code === "P2002") {
      return false;
    }
    console.error(`[DeadlineScheduler] Failed to claim reminder ${reminderType} for task ${taskId}:`, err);
    return false;
  }
}

async function processDeadlineNotification(
  task: any,
  urgency: "3_DAYS" | "1_DAY" | "1_HOUR",
  timeRemainingText: string
) {
  const taskUrl = `${env.CLIENT_URL}/tasks/${task.id}`;
  const formattedDeadline = new Date(task.deadline).toLocaleString();

  // Create In-App Notifications
  const recipientUserIds = new Set<string>();
  if (task.assignedToId) recipientUserIds.add(task.assignedToId);
  recipientUserIds.add(task.createdById);

  for (const userId of recipientUserIds) {
    try {
      await prisma.notification.create({
        data: {
          userId,
          taskId: task.id,
          type: "DEADLINE_REMINDER",
          message: `Deadline reminder: "${task.title}" is due in ${timeRemainingText}!`,
        },
      });
    } catch (e) {
      console.error("[DeadlineScheduler] Error creating reminder notification:", e);
    }
  }

  // Send Reminder Emails
  const recipients = [
    { email: task.assignedEmail, name: task.assignedName },
    { email: task.createdBy?.email, name: task.createdBy?.name },
  ].filter((r) => !!r.email);

  const uniqueRecipients = recipients.filter(
    (item, index, self) => index === self.findIndex((t) => t.email.toLowerCase() === item.email.toLowerCase())
  );

  for (const recipient of uniqueRecipients) {
    sendResendEmail({
      to: recipient.email,
      subject: `Deadline Reminder (${timeRemainingText} left): ${task.title}`,
      html: deadlineReminderTemplate({
        title: task.title,
        recipientName: recipient.name,
        deadline: formattedDeadline,
        timeRemainingText,
        urgency,
        taskUrl,
        jiraUrl: task.jiraUrl,
      }),
      eventType: `DEADLINE_REMINDER_${urgency}`,
      taskId: task.id,
      idempotencyKey: `deadline-reminder/${task.id}/${urgency}/${recipient.email}`,
      metadata: { taskId: task.id, urgency },
    }).catch((e) => console.error("[DeadlineScheduler] Email send failed:", e));
  }
}

async function processOverdueNotification(task: any) {
  const taskUrl = `${env.CLIENT_URL}/tasks/${task.id}`;
  const formattedDeadline = new Date(task.deadline).toLocaleString();

  // In-app notifications
  const recipientUserIds = new Set<string>();
  if (task.assignedToId) recipientUserIds.add(task.assignedToId);
  recipientUserIds.add(task.createdById);

  for (const userId of recipientUserIds) {
    try {
      await prisma.notification.create({
        data: {
          userId,
          taskId: task.id,
          type: "TASK_OVERDUE",
          message: `Task Overdue: "${task.title}" has passed its deadline!`,
        },
      });
    } catch (e) {
      console.error("[DeadlineScheduler] Error creating overdue notification:", e);
    }
  }

  // Email
  const recipients = [
    { email: task.assignedEmail, name: task.assignedName },
    { email: task.createdBy?.email, name: task.createdBy?.name },
  ].filter((r) => !!r.email);

  const uniqueRecipients = recipients.filter(
    (item, index, self) => index === self.findIndex((t) => t.email.toLowerCase() === item.email.toLowerCase())
  );

  for (const recipient of uniqueRecipients) {
    sendResendEmail({
      to: recipient.email,
      subject: `Overdue Task Alert: ${task.title}`,
      html: taskOverdueTemplate({
        title: task.title,
        recipientName: recipient.name,
        deadline: formattedDeadline,
        taskUrl,
      }),
      eventType: "TASK_OVERDUE",
      taskId: task.id,
      idempotencyKey: `overdue/${task.id}/${recipient.email}`,
      metadata: { taskId: task.id },
    }).catch((e) => console.error("[DeadlineScheduler] Overdue email send failed:", e));
  }
}

/**
 * Initializes cron schedule. Checks every 2 minutes.
 */
export function initDeadlineCron() {
  console.log("[DeadlineScheduler] Initializing cron job (every 2 minutes)...");
  
  // Delay first run by 3 seconds to let connection pools settle
  setTimeout(() => {
    runDeadlineChecks().catch((err) =>
      console.warn("[DeadlineScheduler] Initial check deferred:", err.message)
    );
  }, 3000);

  cron.schedule("*/2 * * * *", async () => {
    console.log("[DeadlineScheduler] Checking deadlines...");
    const stats = await runDeadlineChecks();
    if (stats.remindersSent > 0 || stats.overdueSent > 0) {
      console.log(`[DeadlineScheduler] Sent ${stats.remindersSent} reminders and ${stats.overdueSent} overdue alerts.`);
    }
  });
}
