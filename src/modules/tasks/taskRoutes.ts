import { Router } from "express";
import {
  createTask,
  getTasks,
  getAssignedToMe,
  getUpcomingDeadlines,
  getDueToday,
  getOverdueTasks,
  getTaskById,
  updateTask,
  updateTaskStatus,
  deleteTask,
  submitForReview,
  completeTask,
  requestChanges,
  sendManualReminder,
} from "./taskController.js";
import { getTaskComments, addComment } from "../comments/commentController.js";
import { getTaskActivity } from "../activity/activityController.js";
import { authenticate, authorizeRoles } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createTaskSchema,
  updateTaskSchema,
  updateStatusSchema,
} from "./taskValidation.js";
import { Role } from "@prisma/client";

const router = Router();

// All task routes require authentication
router.use(authenticate);

// Specific queries defined BEFORE /:id
router.get("/assigned-to-me", getAssignedToMe);
router.get("/upcoming-deadlines", getUpcomingDeadlines);
router.get("/due-today", getDueToday);
router.get("/overdue", getOverdueTasks);

// List and Create
router.get("/", getTasks);
router.post(
  "/",
  authorizeRoles(Role.ADMIN),
  validate(createTaskSchema),
  createTask
);

// Workflow endpoints
router.post("/:id/submit-review", submitForReview);
router.post("/:id/complete", authorizeRoles(Role.ADMIN), completeTask);
router.post("/:id/request-changes", authorizeRoles(Role.ADMIN), requestChanges);
router.post("/:id/remind", authorizeRoles(Role.ADMIN), sendManualReminder);

// Specific task operations
router.get("/:id", getTaskById);
router.patch("/:id/status", validate(updateStatusSchema), updateTaskStatus);
router.patch("/:id", validate(updateTaskSchema), updateTask);
router.delete("/:id", authorizeRoles(Role.ADMIN), deleteTask);

// Task comments
router.get("/:taskId/comments", getTaskComments);
router.post("/:taskId/comments", addComment);

// Task activity
router.get("/:taskId/activity", getTaskActivity);

export default router;
