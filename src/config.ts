import dotenv from "dotenv";

dotenv.config({ quiet: true });

export const CONFIDENCE_THRESHOLD = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.7);

// Caps inbound WhatsApp messages per tenant phone number within a sliding
// window — without this, a tenant (or anyone spoofing/spamming their number)
// can drive unbounded answerFaqQuestion() calls, each an Anthropic API call.
export const RATE_LIMIT_MAX_MESSAGES = Number(process.env.RATE_LIMIT_MAX_MESSAGES ?? 8);
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
