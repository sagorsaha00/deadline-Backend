import { Response } from "express";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";
import { Role } from "@prisma/client";
import { sendEmail } from "../emails/emailService.js";
import { newCommentTemplate } from "../emails/emailTemplates.js";
import { env } from "../../config/env.js";

export async function getTaskComments(req: AuthRequest, res: Response) {
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
        return sendError(res, "Forbidden: You cannot view comments on this task", 403);
      }
    }

    const comments = await prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
        attachments: true,
      },
    });

    return sendSuccess(res, comments, "Comments retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve comments", 500, error);
  }
}

export async function addComment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const taskId = String(req.params.taskId);
    const { content, attachmentIds } = req.body;

    if (!content || !content.trim()) {
      return sendError(res, "Comment content cannot be empty", 400);
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: true,
        createdBy: true,
      },
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
        return sendError(res, "Forbidden: You cannot comment on this task", 403);
      }
    }

    const comment = await prisma.$transaction(async (tx: any) => {
      const newComment = await tx.comment.create({
        data: {
          taskId,
          userId: req.user!.id,
          content: content.trim(),
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true, avatarUrl: true },
          },
          attachments: true,
        },
      });

      // Associate any existing attachments uploaded for this comment
      if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds.map(String) },
            taskId,
          },
          data: {
            commentId: newComment.id,
          },
        });
      }

      // Log activity
      await tx.activityLog.create({
        data: {
          taskId,
          userId: req.user!.id,
          activityType: "Comment Added",
          description: `${req.user!.name} commented: "${content.trim().slice(0, 80)}${content.trim().length > 80 ? "..." : ""}"`,
        },
      });

      // In-app notifications to relevant participants (assignee and creator, excluding the comment author)
      const recipientIds = new Set<string>();
      if (task.assignedToId && task.assignedToId !== req.user!.id) {
        recipientIds.add(task.assignedToId);
      }
      if (task.createdById !== req.user!.id) {
        recipientIds.add(task.createdById);
      }

      for (const recipientId of recipientIds) {
        await tx.notification.create({
          data: {
            userId: recipientId,
            taskId,
            type: "NEW_COMMENT",
            message: `${req.user!.name} commented on "${task.title}": ${content.trim().slice(0, 60)}...`,
          },
        });
      }

      return newComment;
    });

    // Fetch comment with updated attachments
    const freshComment = await prisma.comment.findUnique({
      where: { id: comment.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
        attachments: true,
      },
    });

    // Send email notification to relevant participants (excluding comment author)
    const emailRecipients: { email: string; name: string }[] = [];
    if (task.assignedEmail.toLowerCase() !== req.user.email.toLowerCase()) {
      emailRecipients.push({ email: task.assignedEmail, name: task.assignedName });
    }
    if (
      task.createdBy.email.toLowerCase() !== req.user.email.toLowerCase() &&
      task.createdBy.email.toLowerCase() !== task.assignedEmail.toLowerCase()
    ) {
      emailRecipients.push({ email: task.createdBy.email, name: task.createdBy.name });
    }

    for (const recipient of emailRecipients) {
      sendEmail({
        to: recipient.email,
        subject: `New Comment on: ${task.title}`,
        html: newCommentTemplate({
          title: task.title,
          recipientName: recipient.name,
          authorName: req.user.name,
          commentPreview: content.trim().slice(0, 150),
          taskUrl: `${env.CLIENT_URL}/tasks/${task.id}`,
        }),
        eventType: "NEW_COMMENT",
        taskId: task.id,
        idempotencyKey: `comment-notif/${comment.id}/${recipient.email}`,
        metadata: { taskId: task.id, commentId: comment.id },
      }).catch((e) => console.error("Error sending comment email:", e));
    }

    return sendSuccess(res, freshComment || comment, "Comment added successfully", 201);
  } catch (error) {
    return sendError(res, "Failed to add comment", 500, error);
  }
}

export async function updateComment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const id = String(req.params.id);
    const { content } = req.body;

    if (!content || !content.trim()) {
      return sendError(res, "Content cannot be empty", 400);
    }

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!comment) {
      return sendError(res, "Comment not found", 404);
    }

    // Role check: Author can edit their own; Admin can edit/moderate
    if (comment.userId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: You cannot edit another user's comment", 403);
    }

    const updated = await prisma.comment.update({
      where: { id },
      data: { content: content.trim() },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
        attachments: true,
      },
    });

    return sendSuccess(res, updated, "Comment updated successfully");
  } catch (error) {
    return sendError(res, "Failed to update comment", 500, error);
  }
}

export async function deleteComment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const id = String(req.params.id);

    const comment = await prisma.comment.findUnique({
      where: { id },
    });

    if (!comment) {
      return sendError(res, "Comment not found", 404);
    }

    // Role check: Author can delete their own; Admin can delete/moderate
    if (comment.userId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: You cannot delete another user's comment", 403);
    }

    await prisma.comment.delete({
      where: { id },
    });

    return sendSuccess(res, null, "Comment deleted successfully");
  } catch (error) {
    return sendError(res, "Failed to delete comment", 500, error);
  }
}

export async function getRecentDiscussions(req: AuthRequest, res: Response) {
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

    const comments = await prisma.comment.findMany({
      where: {
        task: taskWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, avatarUrl: true },
        },
        task: {
          select: { id: true, title: true, priority: true, status: true, deadline: true },
        },
        attachments: true,
      },
    });

    return sendSuccess(res, comments, "Recent discussions retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve discussions", 500, error);
  }
}
