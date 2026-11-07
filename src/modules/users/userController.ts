import { Response } from "express";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";

export async function getUsers(req: AuthRequest, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    return sendSuccess(res, users, "Users retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve users", 500, error);
  }
}

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return sendError(res, "Unauthorized", 401);
    }

    if (req.body.role !== undefined && req.body.role !== req.user.role) {
      return sendError(res, "Forbidden: Self-role promotion or role modification is not permitted.", 403);
    }

    const { name, avatarUrl } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: name ? name.trim() : undefined,
        avatarUrl: avatarUrl !== undefined ? avatarUrl : undefined,
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

    return sendSuccess(res, updated, "Profile updated successfully");
  } catch (error) {
    return sendError(res, "Failed to update profile", 500, error);
  }
}

export async function updateUserRole(req: AuthRequest, res: Response) {
  try {
    const id = String(req.params.id);
    const { role } = req.body;

    if (!role || (role !== "ADMIN" && role !== "MEMBER")) {
      return sendError(res, "Invalid role. Allowed values: ADMIN, MEMBER", 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return sendError(res, "User not found", 404);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    return sendSuccess(res, updated, "User role updated successfully");
  } catch (error) {
    return sendError(res, "Failed to update user role", 500, error);
  }
}
