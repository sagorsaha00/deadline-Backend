/**
 * Re-exporting from resendService to completely deprecate Nodemailer and use Resend exclusively.
 */
export {
  sendResendEmail,
  sendEmail,
  type SendResendEmailOptions,
} from "./resendService.js";
