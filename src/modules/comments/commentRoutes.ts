import { Router } from "express";
import {
  getTaskComments,
  addComment,
  updateComment,
  deleteComment,
  getRecentDiscussions,
} from "./commentController.js";
import { authenticate } from "../../middleware/auth.js";

const router = Router();

router.use(authenticate);

// Discussions feed across authorized tasks
router.get("/recent", getRecentDiscussions);

// Single comment edit / delete
router.patch("/:id", updateComment);
router.delete("/:id", deleteComment);

export default router;
