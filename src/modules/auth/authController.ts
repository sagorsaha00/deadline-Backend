import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../config/db.js";
import { signToken } from "../../utils/jwt.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";
import { sendEmail } from "../emails/emailService.js";
import { passwordResetTemplate } from "../emails/emailTemplates.js";
import { env } from "../../config/env.js";

export async function register(req: Request, res: Response) {
  try {
    const { name, email, password, role } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return sendError(res, "Email is already registered", 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // SECURITY ENFORCEMENT: Public registration ALWAYS creates MEMBER accounts only.
    // Never trust frontend-supplied roles (e.g. "ADMIN", "SUPER_ADMIN"); ignore/reject forged values.
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: "MEMBER",
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    // Auto-link any existing tasks that were assigned to this email before registration
    await prisma.task.updateMany({
      where: {
        assignedEmail: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
        assignedToId: null,
      },
      data: {
        assignedToId: user.id,
      },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return sendSuccess(
      res,
      { user, token },
      "Registration successful! Welcome to DeadlineHub.",
      201
    );
  } catch (error) {
    return sendError(res, "Failed to register user", 500, error);
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return sendError(res, "Invalid email or password", 401);
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendError(res, "Invalid email or password", 401);
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };

    return sendSuccess(res, { user: safeUser, token }, "Login successful");
  } catch (error) {
    return sendError(res, "Failed to login", 500, error);
  }
}

export async function getCurrentUser(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return sendError(res, "Unauthorized", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        _count: {
          select: {
            tasksAssigned: true,
            tasksCreated: true,
            notifications: {
              where: { isRead: false },
            },
          },
        },
      },
    });

    if (!user) {
      return sendError(res, "User not found", 404);
    }

    return sendSuccess(res, user, "User profile fetched successfully");
  } catch (error) {
    return sendError(res, "Failed to fetch current user", 500, error);
  }
}

export async function logout(req: Request, res: Response) {
  // JWT is stateless; client clears token
  return sendSuccess(res, null, "Logout successful");
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Always respond with success to avoid leaking registered user emails
    if (!user) {
      return sendSuccess(
        res,
        null,
        "If an account with that email exists, a password reset link has been sent."
      );
    }

    // Invalidate existing tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });

    const resetUrl = `${env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your DeadlineHub password",
      html: passwordResetTemplate({
        recipientName: user.name,
        resetUrl,
      }),
      templateName: "PASSWORD_RESET",
      metadata: { userId: user.id },
    });

    return sendSuccess(
      res,
      process.env.NODE_ENV === "development" ? { resetToken, resetUrl } : null,
      "If an account with that email exists, a password reset link has been sent."
    );
  } catch (error) {
    return sendError(res, "Failed to process forgot password request", 500, error);
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (
      !resetRecord ||
      resetRecord.used ||
      new Date() > resetRecord.expiresAt
    ) {
      return sendError(res, "Invalid or expired reset token", 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used: true },
      }),
    ]);

    return sendSuccess(res, null, "Password reset successfully. You can now login.");
  } catch (error) {
    return sendError(res, "Failed to reset password", 500, error);
  }
}

export async function changePassword(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return sendError(res, "Unauthorized", 401);
    }

    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return sendError(res, "User not found", 404);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return sendError(res, "Current password does not match", 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return sendSuccess(res, null, "Password changed successfully");
  } catch (error) {
    return sendError(res, "Failed to change password", 500, error);
  }
}
