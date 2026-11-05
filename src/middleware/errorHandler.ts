import { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("Unhandled error:", err);

  const status = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  return sendError(res, message, status, process.env.NODE_ENV === "development" ? err.stack : undefined);
}
