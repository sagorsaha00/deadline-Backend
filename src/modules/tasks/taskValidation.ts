import { z } from "zod";

const jiraUrlRegex = /^(https?:\/\/[^\s]+)$/i;

export const createTaskSchema = z.object({
  body: z.object({
    title: z.string().min(2, "Title must be at least 2 characters").max(200),
    description: z.string().optional().nullable(),
    jiraUrl: z
      .string()
      .trim()
      .refine(
        (val) => !val || jiraUrlRegex.test(val),
        "Jira URL must be a valid HTTP or HTTPS URL"
      )
      .optional()
      .nullable(),
    assignedName: z.string().min(1, "Assigned person name is required"),
    assignedEmail: z.string().email("Valid assigned person email is required"),
    deadline: z.string().refine((val) => !isNaN(Date.parse(val)), "Valid deadline date and time required"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  }),
});

export const updateTaskSchema = z.object({
  body: z.object({
    title: z.string().min(2).max(200).optional(),
    description: z.string().optional().nullable(),
    jiraUrl: z
      .string()
      .trim()
      .refine(
        (val) => !val || jiraUrlRegex.test(val),
        "Jira URL must be a valid HTTP or HTTPS URL"
      )
      .optional()
      .nullable(),
    assignedName: z.string().min(1).optional(),
    assignedEmail: z.string().email().optional(),
    deadline: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), "Valid deadline date and time required")
      .optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "COMPLETED"]).optional(),
  }),
});

export const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "COMPLETED"]),
  }),
});
