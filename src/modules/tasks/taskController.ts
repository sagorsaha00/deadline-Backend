import { Response } from "express";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { AuthRequest } from "../../middleware/auth.js";
import { TaskStatus, Priority, Role } from "@prisma/client";
import { sendEmail, sendTaskAssignmentEmail } from "../emails/emailService.js";
import {
  taskAssignmentTemplate,
  taskCompletedTemplate,
  taskSubmittedForReviewTemplate,
  deadlineReminderTemplate,
} from "../emails/emailTemplates.js";
import { env } from "../../config/env.js";

function enrichTaskWithOverdue<T extends { deadline: Date; status: TaskStatus; completedAt: Date | null }>(
  task: T
) {
  const now = new Date();
  const isOverdue = task.status !== TaskStatus.COMPLETED && new Date(task.deadline) < now;
  return {
    ...task,
    isOverdue,
  };
}

export async function createTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const {
      title,
      description,
      jiraUrl,
      assignedToId,
      assignedName,
      assignedEmail,
      deadline,
      priority,
    } = req.body;

    // 1. Retrieve the assigned Member from database using assignedToId or registered email
    let assignedUser: any = null;
    if (assignedToId) {
      assignedUser = await prisma.user.findUnique({
        where: { id: assignedToId },
      });
    }

    if (!assignedUser && assignedEmail) {
      const normalizedAssignedEmail = assignedEmail.trim().toLowerCase();
      assignedUser = await prisma.user.findUnique({
        where: { email: normalizedAssignedEmail },
      });
    }

    const finalAssignedToId = assignedUser ? assignedUser.id : (assignedToId || null);
    const finalAssignedEmail = assignedUser ? assignedUser.email : (assignedEmail ? assignedEmail.trim().toLowerCase() : "");
    const finalAssignedName = assignedUser ? assignedUser.name : (assignedName ? assignedName.trim() : "Unassigned");

    const parsedDeadline = new Date(deadline);

    // Database transaction: create task + log activity + create in-app notification for Member
    const task = await prisma.$transaction(async (tx: any) => {
      const createdTask = await tx.task.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          jiraUrl: jiraUrl?.trim() || null,
          assignedName: finalAssignedName,
          assignedEmail: finalAssignedEmail,
          assignedToId: finalAssignedToId,
          createdById: req.user!.id,
          deadline: parsedDeadline,
          priority: (priority as Priority) || Priority.MEDIUM,
          status: TaskStatus.TODO,
        },
        include: {
          assignedTo: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Log creation
      await tx.activityLog.create({
        data: {
          taskId: createdTask.id,
          userId: req.user!.id,
          activityType: "Task Created",
          description: `Task "${createdTask.title}" was created by ${req.user!.name}`,
        },
      });

      // Log assignment
      await tx.activityLog.create({
        data: {
          taskId: createdTask.id,
          userId: req.user!.id,
          activityType: "Task Assigned",
          description: `Assigned to ${createdTask.assignedName} (${createdTask.assignedEmail})`,
        },
      });

      // Create in-app notification strictly for the assigned Member
      if (assignedUser) {
        await tx.notification.create({
          data: {
            userId: assignedUser.id,
            taskId: createdTask.id,
            type: "TASK_ASSIGNED",
            title: "New Task Assigned",
            message: `${req.user!.name} assigned you to task: "${createdTask.title}"`,
            isRead: false,
          },
        });
      }

      return createdTask;
    });

    // Send assignment email strictly to the assigned member's registered email
    // (Never send to Admin or creator)
    sendTaskAssignmentEmail(task.id).catch((e) =>
      console.error("[TaskController] Error sending task assignment email:", e)
    );

    return sendSuccess(res, enrichTaskWithOverdue(task), "Task created successfully", 201);
  } catch (error) {
    return sendError(res, "Failed to create task", 500, error);
  }
}

export async function getTasks(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const {
      page = "1",
      limit = "10",
      search,
      status,
      priority,
      assignedToId,
      sortBy = "deadline",
      sortOrder = "asc",
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    // Role-based filtering:
    // If user is MEMBER, they can only view tasks assigned to them or their email or created by them
    if (req.user.role === Role.MEMBER) {
      where.OR = [
        { assignedToId: req.user.id },
        { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
        { createdById: req.user.id },
      ];
    } else if (assignedToId) {
      where.assignedToId = assignedToId;
    }

    if (search) {
      const searchClause = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { assignedName: { contains: search, mode: "insensitive" } },
          { assignedEmail: { contains: search, mode: "insensitive" } },
        ],
      };
      if (where.OR) {
        where.AND = [searchClause];
      } else {
        where.OR = searchClause.OR;
      }
    }

    if (status && Object.values(TaskStatus).includes(status as TaskStatus)) {
      where.status = status;
    }

    if (priority && Object.values(Priority).includes(priority as Priority)) {
      where.priority = priority;
    }

    const orderBy: any = {};
    if (sortBy === "deadline" || sortBy === "createdAt" || sortBy === "priority" || sortBy === "title") {
      orderBy[sortBy] = sortOrder === "desc" ? "desc" : "asc";
    } else {
      orderBy.deadline = "asc";
    }

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          assignedTo: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { comments: true },
          },
        },
      }),
    ]);

    const enrichedTasks = tasks.map(enrichTaskWithOverdue);

    return sendSuccess(
      res,
      {
        tasks: enrichedTasks,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount: total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      "Tasks retrieved successfully"
    );
  } catch (error) {
    return sendError(res, "Failed to retrieve tasks", 500, error);
  }
}

export async function getDashboardStats(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const endOfTomorrow = new Date(endOfToday.getTime() + 24 * 60 * 60 * 1000);
    const endOf7Days = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

    const isAdmin = req.user.role === Role.ADMIN;

    // Base filter: Admin sees all tasks; Member sees only assigned tasks
    const baseWhere: any = isAdmin
      ? {}
      : {
          OR: [
            { assignedToId: req.user.id },
            { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
          ],
        };

    const allTasks = await prisma.task.findMany({
      where: baseWhere,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        deadline: true,
        completedAt: true,
        assignedToId: true,
        assignedName: true,
        assignedEmail: true,
      },
    });

    const totalTasks = allTasks.length;
    let todoCount = 0;
    let inProgressCount = 0;
    let inReviewCount = 0;
    let completedCount = 0;
    let overdueCount = 0;

    let dueToday = 0;
    let dueTomorrow = 0;
    let dueIn7Days = 0;

    for (const t of allTasks) {
      if (t.status === TaskStatus.TODO) todoCount++;
      else if (t.status === TaskStatus.IN_PROGRESS) inProgressCount++;
      else if (t.status === TaskStatus.IN_REVIEW) inReviewCount++;
      else if (t.status === TaskStatus.COMPLETED) completedCount++;

      const isCompleted = t.status === TaskStatus.COMPLETED;
      const dTime = new Date(t.deadline).getTime();

      if (!isCompleted && dTime < now.getTime()) {
        overdueCount++;
      }

      if (!isCompleted && dTime >= now.getTime()) {
        if (dTime < endOfToday.getTime()) {
          dueToday++;
        } else if (dTime < endOfTomorrow.getTime()) {
          dueTomorrow++;
        }
        if (dTime <= endOf7Days.getTime()) {
          dueIn7Days++;
        }
      }
    }

    const completionProgress = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
    const remainingCount = totalTasks - completedCount;

    // Team progress breakdown (for ADMIN only)
    let teamProgress: any[] = [];
    if (isAdmin) {
      const users = await prisma.user.findMany({
        where: { role: Role.MEMBER },
        select: { id: true, name: true, email: true, avatarUrl: true },
        orderBy: { name: "asc" },
      });

      teamProgress = users.map((u) => {
        const userTasks = allTasks.filter(
          (t) => t.assignedToId === u.id || t.assignedEmail.toLowerCase() === u.email.toLowerCase()
        );
        const uTotal = userTasks.length;
        const uCompleted = userTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
        const uInProgress = userTasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
        const uInReview = userTasks.filter((t) => t.status === TaskStatus.IN_REVIEW).length;
        const uTodo = userTasks.filter((t) => t.status === TaskStatus.TODO).length;
        const uOverdue = userTasks.filter(
          (t) => t.status !== TaskStatus.COMPLETED && new Date(t.deadline).getTime() < now.getTime()
        ).length;
        const uPercentage = uTotal > 0 ? Math.round((uCompleted / uTotal) * 100) : 0;

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          totalAssigned: uTotal,
          todo: uTodo,
          inProgress: uInProgress,
          inReview: uInReview,
          completed: uCompleted,
          overdue: uOverdue,
          completionPercentage: uPercentage,
        };
      });
    }

    return sendSuccess(
      res,
      {
        totalTasks,
        todoCount,
        inProgressCount,
        inReviewCount,
        completedCount,
        overdueCount,
        remainingCount,
        completionProgress,
        deadlines: {
          dueToday,
          dueTomorrow,
          dueIn7Days,
          overdue: overdueCount,
          completed: completedCount,
        },
        teamProgress,
      },
      "Dashboard statistics retrieved successfully"
    );
  } catch (error) {
    return sendError(res, "Failed to retrieve dashboard statistics", 500, error);
  }
}

export async function getAssignedToMe(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const tasks = await prisma.task.findMany({
      where: {
        OR: [
          { assignedToId: req.user.id },
          { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
        ],
      },
      orderBy: { deadline: "asc" },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    return sendSuccess(res, tasks.map(enrichTaskWithOverdue), "Assigned tasks retrieved");
  } catch (error) {
    return sendError(res, "Failed to retrieve assigned tasks", 500, error);
  }
}

export async function getUpcomingDeadlines(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const now = new Date();
    const where: any = {
      status: { not: TaskStatus.COMPLETED },
      deadline: { gte: now },
    };

    if (req.user.role === Role.MEMBER) {
      where.OR = [
        { assignedToId: req.user.id },
        { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { deadline: "asc" },
      take: 10,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return sendSuccess(res, tasks.map(enrichTaskWithOverdue), "Upcoming deadlines retrieved");
  } catch (error) {
    return sendError(res, "Failed to retrieve upcoming deadlines", 500, error);
  }
}

export async function getDueToday(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const where: any = {
      status: { not: TaskStatus.COMPLETED },
      deadline: {
        gte: startOfToday,
        lte: endOfToday,
      },
    };

    if (req.user.role === Role.MEMBER) {
      where.OR = [
        { assignedToId: req.user.id },
        { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { deadline: "asc" },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return sendSuccess(res, tasks.map(enrichTaskWithOverdue), "Tasks due today retrieved");
  } catch (error) {
    return sendError(res, "Failed to retrieve tasks due today", 500, error);
  }
}

export async function getOverdueTasks(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const now = new Date();
    const where: any = {
      status: { not: TaskStatus.COMPLETED },
      deadline: { lt: now },
    };

    if (req.user.role === Role.MEMBER) {
      where.OR = [
        { assignedToId: req.user.id },
        { assignedEmail: { equals: req.user.email, mode: "insensitive" } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { deadline: "asc" },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return sendSuccess(res, tasks.map(enrichTaskWithOverdue), "Overdue tasks retrieved");
  } catch (error) {
    return sendError(res, "Failed to retrieve overdue tasks", 500, error);
  }
}

export async function getTaskById(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const id = String(req.params.id);

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true, role: true },
            },
          },
        },
        activityLogs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
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
        return sendError(res, "Forbidden: You do not have permission to view this task", 403);
      }
    }

    return sendSuccess(res, enrichTaskWithOverdue(task), "Task retrieved successfully");
  } catch (error) {
    return sendError(res, "Failed to retrieve task", 500, error);
  }
}

export async function updateTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const id = String(req.params.id);

    const existing = await prisma.task.findUnique({
      where: { id },
      include: { assignedTo: true, createdBy: true },
    });

    if (!existing) {
      return sendError(res, "Task not found", 404);
    }

    // If MEMBER, they can only update status
    if (req.user.role === Role.MEMBER) {
      const isAssigned =
        existing.assignedToId === req.user.id ||
        existing.assignedEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!isAssigned) {
        return sendError(res, "Forbidden: You are not assigned to this task", 403);
      }

      if (req.body.status && Object.keys(req.body).length === 1) {
        return updateTaskStatus(req, res);
      } else {
        return sendError(res, "Forbidden: Members can only update task status", 403);
      }
    }

    // ADMIN updates
    const {
      title,
      description,
      jiraUrl,
      assignedToId,
      assignedName,
      assignedEmail,
      deadline,
      priority,
      status,
    } = req.body;

    const dataToUpdate: any = {};
    const activities: { type: string; desc: string }[] = [];

    if (title && title.trim() !== existing.title) {
      dataToUpdate.title = title.trim();
      activities.push({
        type: "Task Updated",
        desc: `Title changed from "${existing.title}" to "${title.trim()}"`,
      });
    }

    if (description !== undefined && description !== existing.description) {
      dataToUpdate.description = description?.trim() || null;
      activities.push({
        type: "Task Updated",
        desc: "Description updated",
      });
    }

    if (jiraUrl !== undefined && jiraUrl !== existing.jiraUrl) {
      dataToUpdate.jiraUrl = jiraUrl?.trim() || null;
      activities.push({
        type: "Task Updated",
        desc: jiraUrl ? `Jira ticket link updated to ${jiraUrl}` : "Jira ticket link removed",
      });
    }

    if (priority && priority !== existing.priority) {
      dataToUpdate.priority = priority;
      activities.push({
        type: "Priority Changed",
        desc: `Priority changed from ${existing.priority} to ${priority}`,
      });
    }

    if (deadline) {
      const newDeadline = new Date(deadline);
      if (newDeadline.getTime() !== new Date(existing.deadline).getTime()) {
        dataToUpdate.deadline = newDeadline;
        activities.push({
          type: "Deadline Changed",
          desc: `Deadline changed to ${newDeadline.toLocaleString()}`,
        });
      }
    }

    let assigneeChanged = false;
    let newAssignedUser: any = null;

    const targetAssignedToId = assignedToId !== undefined ? assignedToId : null;
    const targetAssignedEmail = assignedEmail ? assignedEmail.trim().toLowerCase() : null;

    // Detect if assignee is being changed
    if (
      (targetAssignedToId && targetAssignedToId !== existing.assignedToId) ||
      (targetAssignedEmail && targetAssignedEmail !== existing.assignedEmail.toLowerCase())
    ) {
      assigneeChanged = true;
      if (targetAssignedToId) {
        newAssignedUser = await prisma.user.findUnique({
          where: { id: targetAssignedToId },
        });
      }
      if (!newAssignedUser && targetAssignedEmail) {
        newAssignedUser = await prisma.user.findUnique({
          where: { email: targetAssignedEmail },
        });
      }

      const finalNewAssignedToId = newAssignedUser ? newAssignedUser.id : targetAssignedToId;
      const finalNewAssignedEmail = newAssignedUser
        ? newAssignedUser.email
        : targetAssignedEmail || existing.assignedEmail;
      const finalNewAssignedName = newAssignedUser
        ? newAssignedUser.name
        : assignedName
        ? assignedName.trim()
        : existing.assignedName;

      dataToUpdate.assignedToId = finalNewAssignedToId;
      dataToUpdate.assignedEmail = finalNewAssignedEmail;
      dataToUpdate.assignedName = finalNewAssignedName;

      activities.push({
        type: "Task Assigned",
        desc: `Reassigned to ${dataToUpdate.assignedName} (${dataToUpdate.assignedEmail})`,
      });
    } else if (assignedName && assignedName.trim() !== existing.assignedName) {
      dataToUpdate.assignedName = assignedName.trim();
    }

    if (status && status !== existing.status) {
      dataToUpdate.status = status;
      if (status === TaskStatus.COMPLETED) {
        dataToUpdate.completedAt = new Date();
        activities.push({
          type: "Task Completed",
          desc: `Task marked as COMPLETED by ${req.user.name}`,
        });
      } else {
        if (existing.status === TaskStatus.COMPLETED) {
          dataToUpdate.completedAt = null;
        }
        activities.push({
          type: "Status Changed",
          desc: `Status changed from ${existing.status} to ${status}`,
        });
      }
    }

    const updatedTask = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.task.update({
        where: { id },
        data: dataToUpdate,
        include: {
          assignedTo: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      for (const act of activities) {
        await tx.activityLog.create({
          data: {
            taskId: updated.id,
            userId: req.user!.id,
            activityType: act.type,
            description: act.desc,
          },
        });
      }

      // Reassignment notifications
      if (assigneeChanged && newAssignedUser) {
        // Notification for newly assigned member (Member B)
        await tx.notification.create({
          data: {
            userId: newAssignedUser.id,
            taskId: updated.id,
            type: "TASK_ASSIGNED",
            title: "New Task Assigned",
            message: `${req.user!.name} assigned you to task: "${updated.title}"`,
            isRead: false,
          },
        });

        // Notification for previously assigned member (Member A)
        if (existing.assignedToId && existing.assignedToId !== newAssignedUser.id) {
          await tx.notification.create({
            data: {
              userId: existing.assignedToId,
              taskId: updated.id,
              type: "TASK_REASSIGNED",
              title: "Task Reassigned",
              message: `Task "${updated.title}" was reassigned to another team member.`,
              isRead: false,
            },
          });
        }
      }

      return updated;
    });

    // Send assignment email ONLY IF assignee changed, and strictly to new assignee!
    if (assigneeChanged) {
      sendTaskAssignmentEmail(updatedTask.id).catch((e) =>
        console.error("[TaskController] Error sending reassignment email:", e)
      );
    }

    // If status changed to COMPLETED, send completion email
    if (status === TaskStatus.COMPLETED && existing.status !== TaskStatus.COMPLETED) {
      const notifyEmails = Array.from(
        new Set([existing.assignedEmail, existing.createdBy.email])
      );
      for (const recipientEmail of notifyEmails) {
        sendEmail({
          to: recipientEmail,
          subject: `Task Completed: ${updatedTask.title}`,
          html: taskCompletedTemplate({
            title: updatedTask.title,
            recipientName: recipientEmail === existing.assignedEmail ? updatedTask.assignedName : existing.createdBy.name,
            completedByName: req.user.name,
            taskUrl: `${env.CLIENT_URL}/tasks/${updatedTask.id}`,
          }),
          eventType: "TASK_COMPLETED",
          taskId: updatedTask.id,
          idempotencyKey: `task-completed/${updatedTask.id}/${recipientEmail}`,
          metadata: { taskId: updatedTask.id },
        }).catch((e) => console.error("Error sending completed email:", e));
      }
    }

    return sendSuccess(res, enrichTaskWithOverdue(updatedTask), "Task updated successfully");
  } catch (error) {
    return sendError(res, "Failed to update task", 500, error);
  }
}

export async function updateTaskStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const id = String(req.params.id);
    const { status } = req.body;

    const task = await prisma.task.findUnique({
      where: { id },
      include: { createdBy: true, assignedTo: true },
    });

    if (!task) {
      return sendError(res, "Task not found", 404);
    }

    // Role check: if MEMBER, ensure user is assigned and cannot mark COMPLETED or reopen
    if (req.user.role === Role.MEMBER) {
      const isAssigned =
        task.assignedToId === req.user.id ||
        task.assignedEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!isAssigned) {
        return sendError(res, "Forbidden: You are not assigned to this task", 403);
      }

      if (status === TaskStatus.COMPLETED) {
        return sendError(
          res,
          "Forbidden: Only administrators can mark tasks as COMPLETED. Please submit your task for review.",
          403
        );
      }

      if (task.status === TaskStatus.COMPLETED) {
        return sendError(
          res,
          "Forbidden: Only administrators can reopen completed tasks.",
          403
        );
      }
    }

    if (task.status === status) {
      return sendSuccess(res, enrichTaskWithOverdue(task), "Status unchanged");
    }

    const isCompleting = status === TaskStatus.COMPLETED;
    const completedAt = isCompleting ? new Date() : null;

    const updated = await prisma.$transaction(async (tx: any) => {
      const result = await tx.task.update({
        where: { id },
        data: {
          status,
          completedAt,
        },
        include: {
          assignedTo: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await tx.activityLog.create({
        data: {
          taskId: id,
          userId: req.user!.id,
          activityType: isCompleting ? "Task Completed" : "Status Changed",
          description: isCompleting
            ? `Task marked as COMPLETED by ${req.user!.name}`
            : `Status changed from ${task.status} to ${status} by ${req.user!.name}`,
        },
      });

      // Notification to creator if updater is not creator
      if (task.createdById !== req.user!.id) {
        await tx.notification.create({
          data: {
            userId: task.createdById,
            taskId: id,
            type: isCompleting ? "TASK_COMPLETED" : "TASK_ASSIGNED",
            message: `${req.user!.name} updated status of "${task.title}" to ${status}`,
          },
        });
      }

      return result;
    });

    if (isCompleting) {
      // Send completion email to creator and assignee
      const recipients = Array.from(new Set([task.assignedEmail, task.createdBy.email]));
      for (const email of recipients) {
        sendEmail({
          to: email,
          subject: `Task Completed: ${task.title}`,
          html: taskCompletedTemplate({
            title: task.title,
            recipientName: email === task.assignedEmail ? task.assignedName : task.createdBy.name,
            completedByName: req.user.name,
            taskUrl: `${env.CLIENT_URL}/tasks/${task.id}`,
          }),
          eventType: "TASK_COMPLETED",
          taskId: task.id,
          idempotencyKey: `task-completed/${task.id}/${email}`,
          metadata: { taskId: task.id },
        }).catch((e) => console.error("Error sending task completed email:", e));
      }
    }

    return sendSuccess(res, enrichTaskWithOverdue(updated), "Task status updated successfully");
  } catch (error) {
    return sendError(res, "Failed to update task status", 500, error);
  }
}

/**
 * Member or Admin submits task for review.
 * Sets status to IN_REVIEW, notifies creator/admin via in-app & email.
 */
export async function submitForReview(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    const id = String(req.params.id);

    const task = await prisma.task.findUnique({
      where: { id },
      include: { createdBy: true, assignedTo: true },
    });

    if (!task) return sendError(res, "Task not found", 404);

    if (req.user.role === Role.MEMBER) {
      const isAssigned =
        task.assignedToId === req.user.id ||
        task.assignedEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!isAssigned) {
        return sendError(res, "Forbidden: You are not assigned to this task", 403);
      }
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const t = await tx.task.update({
        where: { id },
        data: { status: TaskStatus.IN_REVIEW },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.activityLog.create({
        data: {
          taskId: id,
          userId: req.user!.id,
          activityType: "Submitted for Review",
          description: `Task "${t.title}" was submitted for review by ${req.user!.name}`,
        },
      });

      // In-app notification to creator
      if (task.createdById !== req.user!.id) {
        await tx.notification.create({
          data: {
            userId: task.createdById,
            taskId: id,
            type: "TASK_SUBMITTED_FOR_REVIEW",
            message: `${req.user!.name} submitted "${t.title}" for your review`,
          },
        });
      }

      return t;
    });

    // Send email to task creator
    sendEmail({
      to: task.createdBy.email,
      subject: `Task Submitted for Review: ${task.title}`,
      html: taskSubmittedForReviewTemplate({
        title: task.title,
        recipientName: task.createdBy.name,
        submittedByName: req.user.name,
        taskUrl: `${env.CLIENT_URL}/tasks/${task.id}`,
      }),
      eventType: "TASK_SUBMITTED_FOR_REVIEW",
      taskId: task.id,
      idempotencyKey: `review-submit/${task.id}/${Date.now()}`,
      metadata: { taskId: task.id },
    }).catch((e) => console.error("Error sending review submission email:", e));

    return sendSuccess(res, enrichTaskWithOverdue(updated), "Task submitted for review successfully");
  } catch (error) {
    return sendError(res, "Failed to submit task for review", 500, error);
  }
}

/**
 * Admin approves and marks task as COMPLETED.
 */
export async function completeTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    if (req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: Only administrators can approve and complete tasks", 403);
    }

    const id = String(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id },
      include: { createdBy: true, assignedTo: true },
    });

    if (!task) return sendError(res, "Task not found", 404);

    const updated = await prisma.$transaction(async (tx: any) => {
      const t = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
        },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.activityLog.create({
        data: {
          taskId: id,
          userId: req.user!.id,
          activityType: "Task Completed",
          description: `Task "${t.title}" was approved and marked COMPLETED by Admin ${req.user!.name}`,
        },
      });

      if (task.assignedToId && task.assignedToId !== req.user!.id) {
        await tx.notification.create({
          data: {
            userId: task.assignedToId,
            taskId: id,
            type: "TASK_COMPLETED",
            message: `Admin ${req.user!.name} approved and completed "${t.title}"`,
          },
        });
      }

      return t;
    });

    // Send email to assignee
    sendEmail({
      to: task.assignedEmail,
      subject: `Task Completed: ${task.title}`,
      html: taskCompletedTemplate({
        title: task.title,
        recipientName: task.assignedName,
        completedByName: req.user.name,
        taskUrl: `${env.CLIENT_URL}/tasks/${task.id}`,
      }),
      eventType: "TASK_COMPLETED",
      taskId: task.id,
      idempotencyKey: `task-completed/${task.id}/${task.assignedEmail}`,
      metadata: { taskId: task.id },
    }).catch((e) => console.error("Error sending completion email:", e));

    return sendSuccess(res, enrichTaskWithOverdue(updated), "Task completed successfully");
  } catch (error) {
    return sendError(res, "Failed to complete task", 500, error);
  }
}

/**
 * Admin requests changes on a task in review (moves IN_REVIEW -> IN_PROGRESS).
 */
export async function requestChanges(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    if (req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: Only administrators can request changes", 403);
    }

    const id = String(req.params.id);
    const { reason } = req.body;

    const task = await prisma.task.findUnique({
      where: { id },
      include: { createdBy: true, assignedTo: true },
    });

    if (!task) return sendError(res, "Task not found", 404);

    const updated = await prisma.$transaction(async (tx: any) => {
      const t = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.IN_PROGRESS,
          completedAt: null,
        },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      const note = reason ? `: "${reason}"` : "";
      await tx.activityLog.create({
        data: {
          taskId: id,
          userId: req.user!.id,
          activityType: "Changes Requested",
          description: `Admin ${req.user!.name} requested changes on "${t.title}"${note}`,
        },
      });

      if (task.assignedToId) {
        await tx.notification.create({
          data: {
            userId: task.assignedToId,
            taskId: id,
            type: "TASK_REOPENED",
            message: `Admin ${req.user!.name} requested changes on "${t.title}"${note}`,
          },
        });
      }

      return t;
    });

    // Notify assignee via email
    sendEmail({
      to: task.assignedEmail,
      subject: `Changes Requested: ${task.title}`,
      html: `
        <h2 style="color: #0F172A;">Changes Requested for "${task.title}"</h2>
        <p>Hello <strong>${task.assignedName}</strong>,</p>
        <p>Admin <strong>${req.user.name}</strong> has reviewed your submission and requested updates:</p>
        <blockquote style="background: #F8FAFC; border-left: 4px solid #F59E0B; padding: 12px; margin: 15px 0;">
          ${reason ? reason : "Please address requested changes and resubmit for review."}
        </blockquote>
        <p><a href="${env.CLIENT_URL}/tasks/${task.id}" style="display:inline-block;padding:10px 20px;background:#0F172A;color:#FFF;text-decoration:none;border-radius:6px;">View Task Details</a></p>
      `,
      eventType: "CHANGES_REQUESTED",
      taskId: task.id,
      idempotencyKey: `changes-requested/${task.id}/${Date.now()}`,
      metadata: { taskId: task.id, reason },
    }).catch((e) => console.error("Error sending changes requested email:", e));

    return sendSuccess(res, enrichTaskWithOverdue(updated), "Changes requested successfully");
  } catch (error) {
    return sendError(res, "Failed to request changes", 500, error);
  }
}

/**
 * Admin triggers manual deadline reminder email & in-app notification.
 */
export async function sendManualReminder(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);
    if (req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: Only administrators can trigger manual reminders", 403);
    }

    const id = String(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id },
      include: { createdBy: true, assignedTo: true },
    });

    if (!task) return sendError(res, "Task not found", 404);

    const taskUrl = `${env.CLIENT_URL}/tasks/${task.id}`;
    const formattedDeadline = new Date(task.deadline).toLocaleString();

    // Log Activity
    await prisma.activityLog.create({
      data: {
        taskId: id,
        userId: req.user.id,
        activityType: "Deadline Reminder Sent",
        description: `Manual deadline reminder sent by Admin ${req.user.name} to ${task.assignedName}`,
      },
    });

    // In-app notification
    if (task.assignedToId) {
      await prisma.notification.create({
        data: {
          userId: task.assignedToId,
          taskId: id,
          type: "DEADLINE_REMINDER",
          message: `Admin ${req.user.name} sent a reminder: "${task.title}" is due on ${formattedDeadline}!`,
        },
      });
    }

    // Reminder Email
    await sendEmail({
      to: task.assignedEmail,
      subject: `Admin Reminder: Deadline for ${task.title}`,
      html: deadlineReminderTemplate({
        title: task.title,
        recipientName: task.assignedName,
        deadline: formattedDeadline,
        timeRemainingText: "Approaching deadline",
        urgency: "MANUAL",
        taskUrl,
        jiraUrl: task.jiraUrl,
      }),
      eventType: "DEADLINE_REMINDER_MANUAL",
      taskId: task.id,
      idempotencyKey: `manual-reminder/${task.id}/${Date.now()}`,
      metadata: { taskId: task.id, triggeredBy: req.user.id },
    });

    return sendSuccess(res, null, `Reminder sent successfully to ${task.assignedEmail}`);
  } catch (error) {
    return sendError(res, "Failed to send deadline reminder", 500, error);
  }
}

export async function deleteTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const id = String(req.params.id);

    const task = await prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      return sendError(res, "Task not found", 404);
    }

    // Role check: Only ADMIN can delete tasks
    if (req.user.role !== Role.ADMIN) {
      return sendError(res, "Forbidden: Only admins can delete tasks", 403);
    }

    await prisma.task.delete({
      where: { id },
    });

    return sendSuccess(res, null, "Task deleted successfully");
  } catch (error) {
    return sendError(res, "Failed to delete task", 500, error);
  }
}
