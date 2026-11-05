export function baseEmailLayout(content: string, title: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #F8FAFC;
      color: #1E293B;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #F8FAFC;
      padding: 30px 15px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
    }
    .header {
      padding: 24px 30px;
      border-bottom: 1px solid #E2E8F0;
      background-color: #FFFFFF;
    }
    .logo-badge {
      display: inline-block;
      font-weight: 700;
      font-size: 18px;
      color: #0F172A;
      letter-spacing: -0.5px;
    }
    .logo-badge span {
      color: #2563EB;
    }
    .content {
      padding: 30px;
      line-height: 1.6;
      font-size: 15px;
      color: #334155;
    }
    .title {
      font-size: 20px;
      font-weight: 600;
      color: #0F172A;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .details-box {
      background-color: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 18px;
      margin: 20px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      color: #64748B;
      font-weight: 500;
    }
    .detail-value {
      color: #0F172A;
      font-weight: 600;
      text-align: right;
    }
    .btn {
      display: inline-block;
      padding: 11px 22px;
      background-color: #0F172A;
      color: #FFFFFF !important;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      border-radius: 6px;
      margin: 15px 0 5px 0;
    }
    .btn-secondary {
      background-color: #F1F5F9;
      color: #1E293B !important;
      border: 1px solid #CBD5E1;
      margin-left: 10px;
    }
    .footer {
      padding: 20px 30px;
      background-color: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      font-size: 12px;
      color: #94A3B8;
      text-align: center;
    }
    .badge-urgent {
      background-color: #FEE2E2;
      color: #DC2626;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-warning {
      background-color: #FEF3C7;
      color: #D97706;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-badge">Deadline<span>Hub</span></div>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} DeadlineHub. All rights reserved. This is an automated notification.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function taskAssignmentTemplate(data: {
  title: string;
  assignedName: string;
  jiraUrl?: string | null;
  deadline: string;
  priority: string;
  taskUrl: string;
  creatorName: string;
  isCreatorConfirmation?: boolean;
}) {
  const content = `
    <h1 class="title">${
      data.isCreatorConfirmation
        ? "Task Created & Assigned"
        : "You have been assigned a task"
    }</h1>
    <p>Hello <strong>${data.assignedName}</strong>,</p>
    <p>${
      data.isCreatorConfirmation
        ? `You have successfully created and assigned the task <strong>"${data.title}"</strong>.`
        : `<strong>${data.creatorName}</strong> has assigned you to the task <strong>"${data.title}"</strong>.`
    }</p>

    <div class="details-box">
      <div class="detail-row">
        <span class="detail-label">Task:</span>
        <span class="detail-value">${data.title}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Priority:</span>
        <span class="detail-value">${data.priority}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Deadline:</span>
        <span class="detail-value">${data.deadline}</span>
      </div>
      ${
        data.jiraUrl
          ? `
      <div class="detail-row">
        <span class="detail-label">Jira Ticket:</span>
        <span class="detail-value"><a href="${data.jiraUrl}" target="_blank" rel="noreferrer noopener" style="color:#2563EB;">Open in Jira &rarr;</a></span>
      </div>`
          : ""
      }
    </div>

    <div>
      <a href="${data.taskUrl}" class="btn">View Task Details</a>
      ${
        data.jiraUrl
          ? `<a href="${data.jiraUrl}" target="_blank" rel="noreferrer noopener" class="btn btn-secondary">Open Jira Ticket</a>`
          : ""
      }
    </div>
  `;

  return baseEmailLayout(content, `Task Assignment: ${data.title}`);
}

export function deadlineReminderTemplate(data: {
  title: string;
  recipientName: string;
  deadline: string;
  timeRemainingText: string;
  urgency: "3_DAYS" | "1_DAY" | "1_HOUR";
  taskUrl: string;
  jiraUrl?: string | null;
}) {
  const badge =
    data.urgency === "1_HOUR"
      ? `<span class="badge-urgent">URGENT: 1 HOUR REMAINING</span>`
      : `<span class="badge-warning">REMINDER: ${data.timeRemainingText.toUpperCase()} REMAINING</span>`;

  const content = `
    <div style="margin-bottom: 12px;">${badge}</div>
    <h1 class="title">Deadline Reminder for "${data.title}"</h1>
    <p>Hello <strong>${data.recipientName}</strong>,</p>
    <p>This is an automated reminder that the deadline for <strong>"${data.title}"</strong> is approaching in <strong>${data.timeRemainingText}</strong>.</p>

    <div class="details-box">
      <div class="detail-row">
        <span class="detail-label">Deadline:</span>
        <span class="detail-value" style="color: #DC2626;">${data.deadline}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Time Remaining:</span>
        <span class="detail-value">${data.timeRemainingText}</span>
      </div>
      ${
        data.jiraUrl
          ? `
      <div class="detail-row">
        <span class="detail-label">Jira Link:</span>
        <span class="detail-value"><a href="${data.jiraUrl}" target="_blank" rel="noreferrer noopener" style="color:#2563EB;">Open Jira &rarr;</a></span>
      </div>`
          : ""
      }
    </div>

    <div>
      <a href="${data.taskUrl}" class="btn">Review Task Now</a>
    </div>
  `;

  return baseEmailLayout(content, `Deadline Reminder: ${data.title} (${data.timeRemainingText} remaining)`);
}

export function taskOverdueTemplate(data: {
  title: string;
  recipientName: string;
  deadline: string;
  taskUrl: string;
}) {
  const content = `
    <div style="margin-bottom: 12px;"><span class="badge-urgent">OVERDUE</span></div>
    <h1 class="title">Task is Overdue: "${data.title}"</h1>
    <p>Hello <strong>${data.recipientName}</strong>,</p>
    <p>The deadline for <strong>"${data.title}"</strong> passed on <strong>${data.deadline}</strong> and the task is not yet marked completed.</p>

    <div>
      <a href="${data.taskUrl}" class="btn">Update Task Status</a>
    </div>
  `;

  return baseEmailLayout(content, `Overdue Task: ${data.title}`);
}

export function taskCompletedTemplate(data: {
  title: string;
  recipientName: string;
  completedByName: string;
  taskUrl: string;
}) {
  const content = `
    <h1 class="title">Task Completed: "${data.title}"</h1>
    <p>Hello <strong>${data.recipientName}</strong>,</p>
    <p>The task <strong>"${data.title}"</strong> was marked completed by <strong>${data.completedByName}</strong>.</p>

    <div>
      <a href="${data.taskUrl}" class="btn">View Completed Task</a>
    </div>
  `;

  return baseEmailLayout(content, `Task Completed: ${data.title}`);
}

export function newCommentTemplate(data: {
  title: string;
  recipientName: string;
  authorName: string;
  commentPreview: string;
  taskUrl: string;
}) {
  const content = `
    <h1 class="title">New Comment on "${data.title}"</h1>
    <p>Hello <strong>${data.recipientName}</strong>,</p>
    <p><strong>${data.authorName}</strong> added a comment:</p>

    <div class="details-box" style="font-style: italic; color: #334155;">
      "${data.commentPreview}"
    </div>

    <div>
      <a href="${data.taskUrl}" class="btn">View Discussion</a>
    </div>
  `;

  return baseEmailLayout(content, `New comment on: ${data.title}`);
}

export function passwordResetTemplate(data: {
  recipientName: string;
  resetUrl: string;
}) {
  const content = `
    <h1 class="title">Password Reset Request</h1>
    <p>Hello <strong>${data.recipientName}</strong>,</p>
    <p>You requested to reset your password for DeadlineHub. Click the button below to set a new password. This link is valid for 1 hour.</p>

    <div>
      <a href="${data.resetUrl}" class="btn">Reset Password</a>
    </div>

    <p style="margin-top: 20px; font-size: 13px; color: #64748B;">
      If you did not request this password reset, please ignore this email.
    </p>
  `;

  return baseEmailLayout(content, "Reset Your DeadlineHub Password");
}
