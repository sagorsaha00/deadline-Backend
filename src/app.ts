import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./modules/auth/authRoutes.js";
import userRoutes from "./modules/users/userRoutes.js";
import taskRoutes from "./modules/tasks/taskRoutes.js";
import commentRoutes from "./modules/comments/commentRoutes.js";
import notificationRoutes from "./modules/notifications/notificationRoutes.js";
import activityRoutes from "./modules/activity/activityRoutes.js";
import attachmentRoutes from "./modules/attachments/attachmentRoutes.js";
import aiRoutes from "./modules/ai/aiRoutes.js";
import { checkDatabaseConnection } from "./config/db.js";

const app = express();

// Security and utility middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow localhost, client url, or server-to-server requests
      if (!origin || origin.includes("localhost") || origin === env.CLIENT_URL) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in development
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads if using local storage fallback
app.use("/uploads", express.static(path.resolve(process.cwd(), "public", "uploads")));

// Root info
app.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    name: "DeadlineHub API",
    version: "1.0.0",
    status: "online",
  });
});

// Health check
app.get("/health", async (_req: Request, res: Response) => {
  const isDbConnected = await checkDatabaseConnection();
  if (isDbConnected) {
    return res.json({
      success: true,
      message: "DeadlineHub API and PostgreSQL are healthy",
    });
  } else {
    return res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/attachments", attachmentRoutes);
app.use("/api/ai", aiRoutes);

// Centralized error handling
app.use(errorHandler);

export default app;
