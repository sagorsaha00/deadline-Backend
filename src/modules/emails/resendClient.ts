import { Resend } from "resend";
import { env } from "../../config/env.js";

let resendInstance: Resend | null = null;

export function getResendClient(): Resend | null {
  if (!env.RESEND_API_KEY) {
    return null;
  }
  if (!resendInstance) {
    resendInstance = new Resend(env.RESEND_API_KEY);
  }
  return resendInstance;
}
