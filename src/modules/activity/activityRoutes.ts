import { Router } from "express";
import {
  getTaskActivity,
  getRecentActivities,
} from "./activityController.js";
import { authenticate } from "../../middleware/auth.js";

const router = Router();

router.use(authenticate);

router.get("/recent", getRecentActivities);
router.get("/task/:taskId", getTaskActivity);

export default router;
