# DeadlineHub – Backend API

DeadlineHub is a lightweight, high-performance Task Assignment and Deadline Management REST API built with Node.js, Express, TypeScript, PostgreSQL, and Prisma ORM (v7).

## Tech Stack
- **Runtime**: Node.js LTS (v22+)
- **Framework**: Express.js (v5) + TypeScript
- **Database & ORM**: PostgreSQL (17) + Prisma ORM (v7 with `@prisma/adapter-pg`)
- **Authentication**: JWT + bcryptjs
- **Scheduling**: node-cron (automated deadline alerts with concurrency-safe deduplication)
- **Emails**: Nodemailer with SMTP and `EmailLog` database tracking
- **Security**: Helmet, CORS, express-rate-limit, Zod input validation

## Quick Start (Docker - Recommended)
1. Ensure Docker Desktop is running.
2. From `deadLine_backend`:
   ```bash
   docker compose up -d --build
   ```
   This will spin up:
   - PostgreSQL (`deadlinehub_db`) on host port `5433`
   - Express Backend (`deadlinehub_api`) on host port `5000`
3. Seed sample data:
   ```bash
   pnpm run seed
   ```

## Local Development (Without Docker Backend)
1. Ensure PostgreSQL is running on `localhost:5433` (e.g. via `docker compose up -d database`).
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Copy environment file:
   ```bash
   cp .env.example .env
   ```
4. Run Prisma migration:
   ```bash
   pnpm exec prisma migrate dev
   ```
5. Seed database:
   ```bash
   pnpm run seed
   ```
6. Start dev server:
   ```bash
   pnpm dev
   ```
   API runs at `http://localhost:5000`

## Default Seed Accounts
- **Admin**: `admin@deadlinehub.com` / `admin123`
- **Member 1**: `sarah.jenkins@company.com` / `member123`
- **Member 2**: `david.chen@company.com` / `member123`

## REST API Endpoints

### Authentication (`/api/auth`)
- `POST /api/auth/register` - Create new user (links any previously assigned tasks)
- `POST /api/auth/login` - Authenticate and return JWT token
- `POST /api/auth/logout` - Invalidate session
- `POST /api/auth/forgot-password` - Generate reset token and email
- `POST /api/auth/reset-password` - Update password with reset token
- `GET /api/auth/me` - Fetch authenticated user profile
- `PATCH /api/auth/change-password` - Update password

### Tasks (`/api/tasks`)
- `GET /api/tasks` - List tasks with pagination, search, status/priority/assignee filters
- `POST /api/tasks` - Create task and assign to member (Admin only)
- `GET /api/tasks/assigned-to-me` - Filter tasks assigned to current user
- `GET /api/tasks/upcoming-deadlines` - Non-completed tasks with approaching deadlines
- `GET /api/tasks/due-today` - Tasks due within current calendar day
- `GET /api/tasks/overdue` - Non-completed tasks past deadline
- `GET /api/tasks/:id` - Get task details with comments and recent activity
- `PATCH /api/tasks/:id` - Full task update (Admin)
- `PATCH /api/tasks/:id/status` - Update task status (Admin & assigned Member)
- `DELETE /api/tasks/:id` - Delete task (Admin only)

### Comments & Discussions (`/api/comments`)
- `GET /api/tasks/:taskId/comments` - List task comments in chronological order
- `POST /api/tasks/:taskId/comments` - Add comment (triggers notifications)
- `PATCH /api/comments/:id` - Edit comment (author or Admin)
- `DELETE /api/comments/:id` - Delete comment (author or Admin)
- `GET /api/comments/recent` - Unified feed of recent discussions across accessible tasks

### In-App Notifications (`/api/notifications`)
- `GET /api/notifications` - Get notifications (with `?unreadOnly=true` filter)
- `PATCH /api/notifications/:id/read` - Mark single notification as read
- `PATCH /api/notifications/read-all` - Mark all notifications as read
- `DELETE /api/notifications/:id` - Delete notification

### Activity History (`/api/activity`)
- `GET /api/activity/task/:taskId` - Audit trail for specific task
- `GET /api/activity/recent` - Recent activities across authorized tasks

## Automated Verification Suite
Run end-to-end API test suite:
```bash
pnpm exec tsx src/scripts/verify-api.ts
```
Run deadline scheduler deduplication check:
```bash
pnpm exec tsx src/scripts/test-scheduler.ts
```
