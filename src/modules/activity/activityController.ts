import { Response } from "express";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";
import { Role } from "@prisma/client";

export async function getTaskActivity(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const taskId = String(req.params.taskId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return sendError(res, "Task not found", 404);
    }

    // Role check: if MEMBER, ensure user is assigned or creator
    if (req.user.role === Role.MEMBER) {
      const isAssigned =
        task.assignedToId === req.user.id ||
        task.assignedEmail.toLowerCase() === req.user.email.toLowerCase();
      const isCreator = task.createdById === req.user.id;
      if (!isAssigned && !isCreator) {
        return sendError(res, "Forbidden: You cannot view activity for this task", 403);
      }
    }

    const activity = await prisma.activityLog.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
      },
    });

    return sendSuccess(res, activity, "Activity log retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve activity log", 500, error);
  }
}

export async function getRecentActivities(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const taskWhere: any = {};
    if (req.user.role === Role.MEMBER) {
      taskWhere.OR = [
        { assignedToId: req.user.id },
        { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
        { createdById: req.user.id },
      ];
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        task: taskWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
        task: {
          select: { id: true, title: true, priority: true, status: true },
        },
      },
    });

    return sendSuccess(res, activities, "Recent activities retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve recent activities", 500, error);
  }
}
