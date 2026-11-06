import { Response } from "express";
import { AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { getGroqClient } from "./groqClient.js";
import { Role, TaskStatus } from "@prisma/client";
import { env } from "../../config/env.js";

function formatTimeRemaining(deadline: Date, isCompleted: boolean): string {
  if (isCompleted) return "Completed";
  const now = Date.now();
  const diffMs = deadline.getTime() - now;
  const isOverdue = diffMs < 0;
  const absDiff = Math.abs(diffMs);
  const hours = Math.round(absDiff / (1000 * 60 * 60));
  const days = Math.round(absDiff / (1000 * 60 * 60 * 24));

  if (isOverdue) {
    if (days >= 1) return `OVERDUE by ${days} day${days > 1 ? "s" : ""}`;
    return `OVERDUE by ${hours} hour${hours > 1 ? "s" : ""}`;
  }
  if (hours < 1) return "Due in less than 1 hour (URGENT)";
  if (hours <= 24) return `Due in ${hours} hour${hours > 1 ? "s" : ""} (TODAY)`;
  return `Due in ${days} day${days > 1 ? "s" : ""}`;
}

export async function chatWithAi(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return sendError(res, "Unauthorized", 401);

    const { message, messages } = req.body;
    const userPrompt =
      message ||
      (Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1].content
        : null);

    if (!userPrompt) {
      return sendError(res, "Please provide a message or prompt.", 400);
    }

    const now = new Date();
    const isAdmin = req.user.role === Role.ADMIN;
    const userId = req.user.id;
    const userEmail = req.user.email.toLowerCase();
    const userName = req.user.name;

    let tasksContext = "";
    let rawTaskList: any[] = [];
    let summaryStats: Record<string, any> = {};

    if (isAdmin) {
      // Admin: view all team tasks
      const allTasks = await prisma.task.findMany({
        take: 100,
        orderBy: [{ deadline: "asc" }],
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { name: true } },
          _count: { select: { comments: true } },
        },
      });

      rawTaskList = allTasks;
      const totalCount = allTasks.length;
      const todoCount = allTasks.filter((t) => t.status === TaskStatus.TODO).length;
      const inProgressCount = allTasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
      const inReviewCount = allTasks.filter((t) => t.status === TaskStatus.IN_REVIEW).length;
      const completedCount = allTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
      const overdueCount = allTasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && new Date(t.deadline).getTime() < now.getTime()
      ).length;
      const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      summaryStats = {
        total: totalCount,
        todo: todoCount,
        inProgress: inProgressCount,
        inReview: inReviewCount,
        completed: completedCount,
        overdue: overdueCount,
        completionPercentage,
      };

      const taskLines = allTasks.map((t, idx) => {
        const isCompleted = t.status === TaskStatus.COMPLETED;
        const timeRemaining = formatTimeRemaining(new Date(t.deadline), isCompleted);
        const jiraPart = t.jiraUrl ? ` | Jira: ${t.jiraUrl}` : "";
        const descPart = t.description ? `\n   Description: ${t.description.slice(0, 150)}` : "";
        return `${idx + 1}. [${t.status}] "${t.title}"
   Priority: ${t.priority} | Due: ${new Date(t.deadline).toLocaleString()} (${timeRemaining})
   Assignee: ${t.assignedName} (${t.assignedEmail})${jiraPart}${descPart}`;
      });

      tasksContext = `
Role: Administrator (Admin)
User Name: ${userName}
Current Server Time: ${now.toISOString()}
Team Metrics:
- Total Tasks: ${totalCount}
- To Do: ${todoCount}
- In Progress: ${inProgressCount}
- In Review (Awaiting Approval): ${inReviewCount}
- Completed: ${completedCount}
- Overdue: ${overdueCount}
- Overall Completion: ${completionPercentage}%

Detailed Task Roster:
${taskLines.length > 0 ? taskLines.join("\n") : "There are currently 0 tasks in the database."}
      `.trim();
    } else {
      // Member: strictly query tasks assigned to this user by ID or email
      const memberTasks = await prisma.task.findMany({
        where: {
          OR: [
            { assignedToId: userId },
            { assignedEmail: { equals: userEmail, mode: "insensitive" } },
          ],
        },
        orderBy: [{ deadline: "asc" }],
        include: {
          createdBy: { select: { name: true, email: true } },
          _count: { select: { comments: true } },
        },
      });

      rawTaskList = memberTasks;
      const totalCount = memberTasks.length;
      const todoCount = memberTasks.filter((t) => t.status === TaskStatus.TODO).length;
      const inProgressCount = memberTasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
      const inReviewCount = memberTasks.filter((t) => t.status === TaskStatus.IN_REVIEW).length;
      const completedCount = memberTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
      const overdueCount = memberTasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && new Date(t.deadline).getTime() < now.getTime()
      ).length;
      const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      // Find nearest upcoming deadline among uncompleted tasks
      const activeTasks = memberTasks.filter((t) => t.status !== TaskStatus.COMPLETED);
      const nearestTask = activeTasks.length > 0 ? activeTasks[0] : null;

      summaryStats = {
        total: totalCount,
        todo: todoCount,
        inProgress: inProgressCount,
        inReview: inReviewCount,
        completed: completedCount,
        overdue: overdueCount,
        completionPercentage,
        nearestTask: nearestTask ? nearestTask.title : null,
      };

      const taskLines = memberTasks.map((t, idx) => {
        const isCompleted = t.status === TaskStatus.COMPLETED;
        const timeRemaining = formatTimeRemaining(new Date(t.deadline), isCompleted);
        const jiraPart = t.jiraUrl ? ` | Jira: ${t.jiraUrl}` : "";
        const descPart = t.description ? `\n   Description: ${t.description.slice(0, 150)}` : "";
        const isNearest = nearestTask && nearestTask.id === t.id ? " [NEAREST DEADLINE]" : "";
        return `${idx + 1}. [${t.status}] "${t.title}"${isNearest}
   Priority: ${t.priority} | Due: ${new Date(t.deadline).toLocaleString()} (${timeRemaining})${jiraPart}${descPart}`;
      });

      tasksContext = `
Role: Team Member
User Name: ${userName}
User Email: ${userEmail}
Current Server Time: ${now.toISOString()}
Personal Progress Overview:
- Total Assigned: ${totalCount}
- To Do: ${todoCount}
- In Progress: ${inProgressCount}
- In Review (Submitted): ${inReviewCount}
- Completed: ${completedCount}
- Overdue: ${overdueCount}
- Completion Progress: ${completionPercentage}%
- Nearest Upcoming Deadline: ${nearestTask ? `"${nearestTask.title}" (${formatTimeRemaining(new Date(nearestTask.deadline), false)})` : "None"}

Your Assigned Tasks:
${taskLines.length > 0 ? taskLines.join("\n") : "You currently have 0 tasks assigned in the system."}
      `.trim();
    }

    const systemPrompt = `
You are the intelligent DeadlineHub AI Copilot, a proactive assistant embedded in a task & deadline management system.
You have real-time access to the user's authentic PostgreSQL database records provided below.

Rules for responding:
1. STRICT AUTHENTICITY: Rely strictly on the Database Context. Answer questions using the actual task titles, priorities, statuses, and deadlines provided.
2. ACCURATE QUERY HANDLING:
   - "What are my tasks?" / "Show my tasks": List all assigned tasks with their status, priority, and deadlines.
   - "What am I working on?": List tasks specifically in [IN_PROGRESS].
   - "What is pending?": List tasks in [TODO] and [IN_PROGRESS].
   - "What is in review?": List tasks in [IN_REVIEW].
   - "What is completed?": List tasks in [COMPLETED].
   - "What is overdue?": Identify any tasks marked OVERDUE.
   - "What is my next deadline?" / "Which task should I work on first?": Highlight the task with the nearest deadline, factoring in priority (CRITICAL/HIGH first).
   - "What is my progress?": Cite the exact completed count, total count, and completion percentage.
3. If the user has 0 tasks assigned, state clearly and politely: "You currently have no tasks assigned in DeadlineHub. When an administrator creates and assigns tasks to you, they will appear here."
4. Be direct, clear, professional, and use clean Markdown with bullet points and bold emphasis.
5. NEVER invent fake task names, fake Jira keys, or fake dates.

Database Context:
${tasksContext}
    `.trim();

    // Fallback generator if Groq is unreachable or fails
    const buildFallbackReply = () => {
      if (rawTaskList.length === 0) {
        return `Hello **${userName}**! You currently have **0 tasks assigned** in DeadlineHub. When an administrator assigns tasks to you, they will appear here.`;
      }

      if (isAdmin) {
        return `### Team Workload Summary (Database Live Records)
Hello **${userName}**! Here is your team overview:
- **Total Tasks:** ${summaryStats.total}
- **In Progress:** ${summaryStats.inProgress}
- **Awaiting Review:** ${summaryStats.inReview}
- **Completed:** ${summaryStats.completed} (${summaryStats.completionPercentage}%)
- **Overdue:** ${summaryStats.overdue}

**Tracked Tasks:**
${rawTaskList.slice(0, 10).map((t) => `- [${t.status}] **${t.title}** (Priority: ${t.priority}, Assignee: ${t.assignedName}, Due: ${new Date(t.deadline).toLocaleDateString()})`).join("\n")}`;
      } else {
        return `### Your Assigned Tasks (Database Live Records)
Hello **${userName}**! Here is your current task summary:
- **Total Assigned:** ${summaryStats.total}
- **In Progress:** ${summaryStats.inProgress}
- **In Review:** ${summaryStats.inReview}
- **Completed:** ${summaryStats.completed} (${summaryStats.completionPercentage}%)
- **Overdue:** ${summaryStats.overdue}

**Your Tasks:**
${rawTaskList.map((t) => {
  const isCompleted = t.status === TaskStatus.COMPLETED;
  const timeRemaining = formatTimeRemaining(new Date(t.deadline), isCompleted);
  return `- [${t.status}] **${t.title}** (Priority: ${t.priority}, ${timeRemaining})${t.jiraUrl ? ` [Jira](${t.jiraUrl})` : ""}`;
}).join("\n")}`;
      }
    };

    const groq = getGroqClient();

    if (groq) {
      const chatHistory = Array.isArray(messages)
        ? messages.slice(-6).map((m: any) => ({
            role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: String(m.content),
          }))
        : [{ role: "user" as const, content: String(userPrompt) }];

      // Try candidate models supported on this Groq account
      const candidateModels = Array.from(
        new Set([
          env.GROQ_MODEL,
          "openai/gpt-oss-120b",
          "qwen/qwen3.8-27b",
          "openai/gpt-oss-safeguard-20b",
          "allam-2-7b",
        ])
      ).filter(Boolean);

      for (const model of candidateModels) {
        try {
          const completion = await groq.chat.completions.create({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...chatHistory,
            ],
            temperature: 0.2,
            max_tokens: 1024,
          });

          const reply = completion.choices[0]?.message?.content?.trim();
          if (reply) {
            return sendSuccess(res, {
              reply,
              model,
            });
          }
        } catch (groqErr: any) {
          console.warn(`[AiController] Model ${model} failed:`, groqErr.message);
        }
      }
    }

    // Contextual fallback strictly built from real PostgreSQL tasks
    return sendSuccess(res, {
      reply: buildFallbackReply(),
      model: "task-assistant",
    });
  } catch (error: any) {
    console.error("[AiController] Unexpected error:", error.message);
    return sendError(res, "Unable to process assistant request at this time", 500);
  }
}
