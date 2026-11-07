import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 5000),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5433/deadlinehub",
  JWT_SECRET: process.env.JWT_SECRET ?? "deadlinehub-default-dev-secret-key-change-in-prod",
  CLIENT_URL: process.env.CLIENT_URL ?? "http://localhost:5173",

  // Gmail SMTP Email Service
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: process.env.SMTP_USER || "sagorsahadev00@gmail.com",
  SMTP_PASS: process.env.SMTP_PASS || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "DeadlineHub <sagorsahadev00@gmail.com>",

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? "",

  // Groq AI
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? "",
  GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-120b",

  // Tavily Search (Optional)
  TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? "",
};
