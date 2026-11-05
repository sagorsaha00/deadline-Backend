import Groq from "groq-sdk";
import { env } from "../../config/env.js";

let groqInstance: Groq | null = null;

export function getGroqClient(): Groq | null {
  if (!env.GROQ_API_KEY || env.GROQ_API_KEY.includes("your_groq")) {
    return null;
  }
  if (!groqInstance) {
    groqInstance = new Groq({
      apiKey: env.GROQ_API_KEY,
    });
  }
  return groqInstance;
}
