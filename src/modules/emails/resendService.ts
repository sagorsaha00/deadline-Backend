import { getResendClient } from "./resendClient.js";
import { env } from "../../config/env.js";
import { prisma } from "../../config/db.js";
import { EmailStatus } from "@prisma/client";

export interface SendResendEmailOptions {
  to: string;
  subject: string;
  html: string;
  eventType: string;
  taskId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Sends an email using the official Resend SDK and records delivery into EmailLog.
 */
export async function sendResendEmail(options: SendResendEmailOptions): Promise<boolean> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalizedTo = options.to?.trim().toLowerCase();

  if (!normalizedTo || !emailRegex.test(normalizedTo)) {
    console.warn(`[ResendService] Invalid recipient address skipped: "${options.to}"`);
    return false;
  }

  // Idempotency check: if an idempotency key was supplied and was already marked SENT, skip duplicate
  if (options.idempotencyKey) {
    try {
      const existing = await prisma.emailLog.findFirst({
        where: {
          idempotencyKey: options.idempotencyKey,
          status: EmailStatus.SENT,
        },
      });
      if (existing) {
        console.log(`[ResendService] Skipping email with idempotency key ${options.idempotencyKey} (already sent).`);
        return true;
      }
    } catch (e) {
      console.warn("[ResendService] Idempotency check error:", e);
    }
  }

  const resendClient = getResendClient();
  const fromAddress = env.EMAIL_FROM || "DeadlineHub <onboarding@resend.dev>";

  // If no Resend API key is configured or it's a dummy value
  const isMock = !env.RESEND_API_KEY || env.RESEND_API_KEY.includes("your_resend");

  if (isMock || !resendClient) {
    console.log(`[ResendService MOCK] Sending email to ${normalizedTo}: "${options.subject}" (Event: ${options.eventType})`);
    try {
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType: options.eventType,
          template: options.eventType,
          provider: "RESEND_MOCK",
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.SENT,
          sentAt: new Date(),
          metadata: JSON.stringify({ ...options.metadata, mocked: true }),
        },
      });
      return true;
    } catch (err) {
      console.error("[ResendService] Failed to record mock email log:", err);
      return true;
    }
  }

  try {
    const response = await resendClient.emails.send({
      from: fromAddress,
      to: [normalizedTo],
      subject: options.subject,
      html: options.html,
      headers: options.idempotencyKey
        ? {
            "X-Entity-Ref-ID": options.idempotencyKey,
          }
        : undefined,
    });

    if (response.error) {
      console.error(`[ResendService] Resend API error for ${normalizedTo}:`, response.error.message);
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType: options.eventType,
          template: options.eventType,
          provider: "RESEND",
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.FAILED,
          errorMessage: response.error.message,
          metadata: JSON.stringify(options.metadata ?? {}),
        },
      });
      return false;
    }

    const providerEmailId = response.data?.id || null;
    console.log(`[ResendService] Email sent successfully via Resend. ID: ${providerEmailId} to ${normalizedTo}`);

    await prisma.emailLog.create({
      data: {
        taskId: options.taskId || null,
        recipient: normalizedTo,
        to: normalizedTo,
        subject: options.subject,
        eventType: options.eventType,
        template: options.eventType,
        provider: "RESEND",
        providerEmailId,
        idempotencyKey: options.idempotencyKey || null,
        status: EmailStatus.SENT,
        sentAt: new Date(),
        metadata: JSON.stringify({ providerEmailId, ...options.metadata }),
      },
    });

    return true;
  } catch (error: any) {
    console.error(`[ResendService] Network/SDK error sending email to ${normalizedTo}:`, error.message);
    try {
      await prisma.emailLog.create({
        data: {
          taskId: options.taskId || null,
          recipient: normalizedTo,
          to: normalizedTo,
          subject: options.subject,
          eventType: options.eventType,
          template: options.eventType,
          provider: "RESEND",
          idempotencyKey: options.idempotencyKey || null,
          status: EmailStatus.FAILED,
          errorMessage: error.message,
          metadata: JSON.stringify(options.metadata ?? {}),
        },
      });
    } catch (dbErr) {
      console.error("[ResendService] Failed to record email error log:", dbErr);
    }
    return false;
  }
}

/**
 * Backward compatibility wrapper for existing `sendEmail` calls.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  templateName?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
  taskId?: string | null;
}): Promise<boolean> {
  const taskId =
    options.taskId ||
    (options.metadata?.taskId ? String(options.metadata.taskId) : null);

  return sendResendEmail({
    to: options.to,
    subject: options.subject,
    html: options.html,
    eventType: options.templateName || "GENERAL",
    taskId,
    idempotencyKey: options.idempotencyKey,
    metadata: options.metadata,
  });
}
