import nodemailer, { Transporter } from "nodemailer";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { EmailStatus } from "@prisma/client";
import { taskAssignmentTemplate } from "./emailTemplates.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  eventType?: string;
  taskId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
  templateName?: string;
}

let cachedTransporter: Transporter | null = null;

/**
 * Initializes and returns the Nodemailer transporter for Gmail SMTP.
 * Strips whitespace from app password if present (Google displays 16-char passwords grouped into 4s).
 */
export function getMailTransporter(): Transporter {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const cleanPass = (env.SMTP_PASS || "").replace(/\s+/g, "");

  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST || "smtp.gmail.com",
    port: env.SMTP_PORT || 587,
    secure: env.SMTP_SECURE, // false for port 587 (STARTTLS)
    auth: {
      user: env.SMTP_USER || "sagorsahadev00@gmail.com",
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: true,
    },
    // Pool connections to avoid repetitive handshakes for batch notifications
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return cachedTransporter;
}

/**
 * Resets the cached transporter (useful when environment variables change or during testing).
 */
export function resetMailTransporter() {
  if (cachedTransporter) {
    try {
      cachedTransporter.close();
    } catch {
      // ignore
    }
    cachedTransporter = null;
  }
}

/**
 * Safely verifies the Gmail SMTP connection without exposing credentials in logs.
 */
export async function verifySmtpConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const transporter = getMailTransporter();
    await transporter.verify();
    return {
      success: true,
      message: `Gmail SMTP connection established successfully (${env.SMTP_HOST}:${env.SMTP_PORT} as ${env.SMTP_USER})`,
    };
  } catch (err: any) {
    const safeErrorMsg = err?.message || "Unknown SMTP connection error";
    return {
      success: false,
      message: `Gmail SMTP verification failed: ${safeErrorMsg}`,
    };
  }
}

/**
 * Sends an email using Gmail SMTP via Nodemailer and records delivery into PostgreSQL EmailLog.
 * Never reports success if SMTP rejects the message.
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const normalizedTo = options.to?.trim().toLowerCase();

  if (!normalizedTo || !normalizedTo.includes("@")) {
    console.warn(`[EmailService] Invalid recipient address skipped: "${options.to}"`);
    return false;
  }

  const eventType = options.eventType || options.templateName || "GENERAL";

  // Check idempotency if a key was provided
  if (options.idempotencyKey) {
    try {
      const existing = await prisma.emailLog.findFirst({
        where: {
          idempotencyKey: options.idempotencyKey,
          status: EmailStatus.SENT,
        },
      });
      if (existing) {
        console.log(`[EmailService] Skipping duplicate email with idempotency key: ${options.idempotencyKey}`);
        return true;
      }
    } catch (e: any) {
      console.warn("[EmailService] Idempotency check warning:", e?.message || e);
    }
  }

  const fromAddress = env.EMAIL_FROM || `DeadlineHub <${env.SMTP_USER || "sagorsahadev00@gmail.com"}>`;
  const transporter = getMailTransporter();

  // If no password configured, log mock delivery for local dev
  const isMock = !env.SMTP_PASS || env.SMTP_PASS.trim() === "";
  if (isMock) {
    console.log(`[EmailService MOCK] Sending email to ${normalizedTo}: "${options.subject}" (Event: ${eventType})`);
    try {
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType,
          provider: "MOCK_SMTP",
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.SENT,
          attempts: 1,
          sentAt: new Date(),
          metadata: options.metadata ? JSON.stringify(options.metadata) : null,
          template: eventType,
        },
      });
      return true;
    } catch (err: any) {
      console.error("[EmailService] Failed to record mock email log:", err?.message || err);
      return false;
    }
  }

  // Attempt real SMTP delivery via Nodemailer
  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: normalizedTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    const providerEmailId = info.messageId || null;
    console.log(`[EmailService] Email sent successfully via Gmail SMTP. MessageId: ${providerEmailId} to ${normalizedTo}`);

    try {
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType,
          provider: "GMAIL_SMTP",
          providerEmailId,
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.SENT,
          attempts: 1,
          sentAt: new Date(),
          metadata: options.metadata ? JSON.stringify(options.metadata) : null,
          template: eventType,
        },
      });
    } catch (logErr: any) {
      if (logErr.code === "P2003") {
        // Task was removed concurrently, retry with taskId: null
        await prisma.emailLog.create({
          data: {
            taskId: null,
            recipient: normalizedTo,
            to: normalizedTo,
            subject: options.subject,
            eventType,
            provider: "GMAIL_SMTP",
            providerEmailId,
            idempotencyKey: options.idempotencyKey || null,
            status: EmailStatus.SENT,
            attempts: 1,
            sentAt: new Date(),
            metadata: options.metadata ? JSON.stringify(options.metadata) : null,
            template: eventType,
          },
        }).catch((e) => console.warn("[EmailService] Failed to record detached email log:", e.message));
      } else {
        console.warn("[EmailService] Failed to record email log:", logErr.message);
      }
    }

    return true;
  } catch (error: any) {
    const errorMessage = error?.message || "Unknown SMTP sending failure";
    console.error(`[EmailService] SMTP error sending to ${normalizedTo}:`, errorMessage);

    try {
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType,
          provider: "GMAIL_SMTP",
          errorMessage,
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.FAILED,
          attempts: 1,
          metadata: options.metadata ? JSON.stringify(options.metadata) : null,
          template: eventType,
        },
      });
    } catch (dbErr: any) {
      console.error("[EmailService] Failed to record email error log:", dbErr?.message || dbErr);
    }

    return false;
  }
}

/**
 * Sends a task assignment email strictly to the assigned Member's registered email address.
 * Never sends to Admin or creator.
 */
export async function sendTaskAssignmentEmail(taskId: string): Promise<boolean> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!task) {
      console.error(`[EmailService] Task "${taskId}" not found for assignment notification.`);
      return false;
    }

    let assignedMember = task.assignedTo;
    if (!assignedMember && task.assignedEmail) {
      assignedMember = await prisma.user.findUnique({
        where: { email: task.assignedEmail.trim().toLowerCase() },
        select: { id: true, name: true, email: true, role: true },
      });
    }

    if (!assignedMember || !assignedMember.email) {
      console.warn(
        `[EmailService] Task "${task.title}" (ID: ${taskId}) has no valid registered assignee email in PostgreSQL. Skipping assignment email. (Fallback to Admin is prohibited).`
      );
      return false;
    }

    const recipientEmail = assignedMember.email.trim().toLowerCase();
    const recipientName = assignedMember.name || task.assignedName || "Team Member";
    const formattedDeadline = new Date(task.deadline).toLocaleString();
    const taskUrl = `${env.CLIENT_URL}/tasks/${task.id}`;

    console.log(
      `[EmailService] Preparing assignment email for task "${task.title}". Recipient: "${recipientEmail}" (Member: ${recipientName}, UserID: ${assignedMember.id})`
    );

    const emailSent = await sendEmail({
      to: recipientEmail,
      subject: "New Task Assigned to You — DeadlineHub",
      html: taskAssignmentTemplate({
        title: task.title,
        assignedName: recipientName,
        jiraUrl: task.jiraUrl,
        deadline: formattedDeadline,
        priority: task.priority,
        status: task.status,
        taskUrl,
        description: task.description,
        creatorName: task.createdBy?.name || "Admin",
      }),
      eventType: "TASK_ASSIGNED",
      taskId: task.id,
      idempotencyKey: `task-assignment/${task.id}/${assignedMember.id}`,
      metadata: {
        taskId: task.id,
        assignedToId: assignedMember.id,
        recipientRole: assignedMember.role,
      },
    });

    return emailSent;
  } catch (err: any) {
    console.error(`[EmailService] Unexpected error sending assignment email for task ${taskId}:`, err?.message || err);
    return false;
  }
}
