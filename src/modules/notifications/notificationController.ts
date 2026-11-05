import { Response } from "express";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";

export async function getMyNotifications(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const { unreadOnly } = req.query;

    const where: any = {
      userId: req.user.id,
    };

    if (unreadOnly === "true") {
      where.isRead = false;
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          task: {
            select: { id: true, title: true, priority: true, status: true, deadline: true },
          },
        },
      }),
      prisma.notification.count({
        where: {
          userId: req.user.id,
          isRead: false,
        },
      }),
    ]);

    return sendSuccess(
      res,
      {
        notifications,
        unreadCount,
      },
      "Notifications retrieved successfully"
    );
  } catch (error) {
    return sendError(res, "Failed to retrieve notifications", 500, error);
  }
}

export async function markAsRead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const id = String(req.params.id);

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return sendError(res, "Notification not found", 404);
    }

    if (notification.userId !== req.user.id) {
      return sendError(res, "Forbidden: Not your notification", 403);
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return sendSuccess(res, updated, "Notification marked as read");
  } catch (error) {
    return sendError(res, "Failed to mark notification as read", 500, error);
  }
}

export async function markAllAsRead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      data: { isRead: true },
    });

    return sendSuccess(res, null, "All notifications marked as read");
  } catch (error) {
    return sendError(res, "Failed to mark all notifications as read", 500, error);
  }
}

export async function deleteNotification(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const id = String(req.params.id);

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return sendError(res, "Notification not found", 404);
    }

    if (notification.userId !== req.user.id) {
      return sendError(res, "Forbidden: Not your notification", 403);
    }

    await prisma.notification.delete({
      where: { id },
    });

    return sendSuccess(res, null, "Notification deleted");
  } catch (error) {
    return sendError(res, "Failed to delete notification", 500, error);
  }
}
