import { Response } from "express";
import { AuthRequest } from "../../middleware/auth.js";
import { prisma } from "../../config/db.js";
import { sendSuccess, sendError } from "../../utils/response.js";
import { getGroqClient } from "./groqClient.js";
import { Role, TaskStatus } from "@prisma/client";
import { env } from "../../config/env.js";

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

    // 1. Fetch authorized tasks from PostgreSQL
    let tasksContext = "";
    if (isAdmin) {
      const allTasks = await prisma.task.findMany({
        take: 50,
        orderBy: [{ deadline: "asc" }],
        include: {
          assignedTo: { select: { name: true, email: true } },
          createdBy: { select: { name: true } },
        },
      });

      const totalCount = allTasks.length;
      const reviewCount = allTasks.filter((t) => t.status === TaskStatus.IN_REVIEW).length;
      const overdueCount = allTasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && new Date(t.deadline) < now
      ).length;

      const taskSummaries = allTasks.slice(0, 25).map((t) => {
        const isOverdue = t.status !== TaskStatus.COMPLETED && new Date(t.deadline) < now;
        return `- [${t.status}] "${t.title}" (Priority: ${t.priority}, Due: ${new Date(t.deadline).toLocaleDateString()}, Assignee: ${t.assignedName}${isOverdue ? ", OVERDUE" : ""}${t.jiraUrl ? `, Jira: ${t.jiraUrl}` : ""})`;
      });

      tasksContext = `
Role: Administrator (Admin)
Current Time: ${now.toISOString()}
Team Overview:
- Total Tracked Tasks: ${totalCount}
- Tasks Awaiting Review: ${reviewCount}
- Overdue Tasks: ${overdueCount}

Active Tasks Sample:
${taskSummaries.join("\n")}
      `.trim();
    } else {
      // Member role: ONLY fetch tasks assigned to this user
      const memberTasks = await prisma.task.findMany({
        where: {
          OR: [
            { assignedToId: req.user.id },
            { assignedEmail: req.user.email.toLowerCase() },
          ],
        },
        orderBy: [{ deadline: "asc" }],
      });

      const totalAssigned = memberTasks.length;
      const pendingReview = memberTasks.filter((t: any) => t.status === TaskStatus.IN_REVIEW).length;
      const overdue = memberTasks.filter(
        (t: any) => t.status !== TaskStatus.COMPLETED && new Date(t.deadline) < now
      ).length;

      const taskSummaries = memberTasks.map((t: any) => {
        const isOverdue = t.status !== TaskStatus.COMPLETED && new Date(t.deadline) < now;
        return `- [${t.status}] "${t.title}" (Priority: ${t.priority}, Due: ${new Date(t.deadline).toLocaleDateString()}${isOverdue ? " - OVERDUE!" : ""}${t.jiraUrl ? `, Jira: ${t.jiraUrl}` : ""})`;
      });

      tasksContext = `
Role: Team Member
User Name: ${req.user.name}
User Email: ${req.user.email}
Current Time: ${now.toISOString()}
Assigned Tasks Overview:
- Total Assigned: ${totalAssigned}
- Under Review: ${pendingReview}
- Overdue: ${overdue}

Your Assigned Tasks:
${taskSummaries.length > 0 ? taskSummaries.join("\n") : "You currently have no tasks assigned."}
      `.trim();
    }

    const systemPrompt = `
You are the DeadlineHub AI Assistant, an intelligent task management copilot for software teams.
You have real-time read-only access to the user's database records.

Rules:
1. STRICT PRIVACY: If the user is a Team Member, only discuss the tasks assigned to them listed in the context. Never invent tasks belonging to other users.
2. If the user is an Administrator, assist them with team metrics, overdue task tracking, workload distribution, and review queue status.
3. Be concise, direct, helpful, and format your response with clean Markdown (bullet points, bold text).
4. If asked about deadlines, always check the exact dates given in the context.
5. If the user asks general technical or Jira workflow questions, give helpful best practices.

Database Context:
${tasksContext}
    `.trim();

    const groq = getGroqClient();

    if (!groq) {
      // Smart fallback when GROQ_API_KEY is not set
      const reply = `
### DeadlineHub Assistant Summary

Hello **${req.user.name}**! Here is your current task summary based on real-time database records:

${
  isAdmin
    ? `**Admin Overview:**
- Tasks needing attention or review are displayed on your dashboard.
- You can filter tasks by priority or status in the Tasks table.
- Use the three-dot menu to send manual reminders or review submitted tasks.`
    : `**Your Assignments:**
- You have tasks currently tracked in the system.
- Once you finish work on a task, remember to click **Submit for Review** so an Admin can approve it!`
}

*(Tip: To enable full Llama 3.3 conversational intelligence, add \`GROQ_API_KEY\` to your backend \`.env\` file).*
      `.trim();

      return sendSuccess(res, { reply, model: "fallback-rule-engine" });
    }

    // Call Groq API
    const chatHistory = Array.isArray(messages)
      ? messages.slice(-6).map((m: any) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: String(m.content),
        }))
      : [{ role: "user" as const, content: String(userPrompt) }];

    const completion = await groq.chat.completions.create({
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const reply = completion.choices[0]?.message?.content || "I couldn't generate a response at this time.";

    return sendSuccess(res, {
      reply,
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  } catch (error: any) {
    console.error("[AiController] Groq error:", error);
    return sendError(res, error.message || "Failed to process AI chat request", 500);
  }
}
