import { Response } from "express";
import { AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { uploadImageBuffer } from "./cloudinaryService.js";
import { Role } from "@prisma/client";

export async function uploadAttachment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    if (!req.file) return sendError(res, "No file uploaded", 400);

    const { taskId, commentId } = req.body;

    if (!taskId) {
      return sendError(res, "taskId is required for uploading task attachments", 400);
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: String(taskId) },
    });

    if (!task) {
      return sendError(res, "Task not found", 404);
    }

    // Upload to Cloudinary (or local fallback)
    const uploadRes = await uploadImageBuffer(
      req.file.buffer,
      req.file.originalname,
      `deadlinehub/tasks/${task.id}`
    );

    // Save attachment in database
    const attachment = await prisma.attachment.create({
      data: {
        taskId: task.id,
        commentId: commentId ? String(commentId) : null,
        uploaderId: req.user.id,
        publicId: uploadRes.publicId,
        secureUrl: uploadRes.secureUrl,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: uploadRes.bytes,
      },
      include: {
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return sendSuccess(res, attachment, "Attachment uploaded successfully", 201);
  } catch (error: any) {
    console.error("[AttachmentController] Upload error:", error);
    return sendError(res, error.message || "Failed to upload attachment", 500);
  }
}

export async function getTaskAttachments(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const taskId = String(req.params.taskId);

    const attachments = await prisma.attachment.findMany({
      where: { taskId },
      include: {
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccess(res, attachments);
  } catch (error: any) {
    console.error("[AttachmentController] Get attachments error:", error);
    return sendError(res, error.message || "Failed to get attachments", 500);
  }
}

export async function deleteAttachment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const attachmentId = String(req.params.id);

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      return sendError(res, "Attachment not found", 404);
    }

    // Only uploader or ADMIN can delete
    if (attachment.uploaderId !== req.user.id && req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: You cannot delete this attachment", 403);
    }

    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    return sendSuccess(res, null, "Attachment deleted successfully");
  } catch (error: any) {
    console.error("[AttachmentController] Delete error:", error);
    return sendError(res, error.message || "Failed to delete attachment", 500);
  }
}
