import dotenv from "dotenv";
import { logEvent } from "./logger.js";
import { sendWhatsAppMessage } from "./whatsapp.js";

dotenv.config({ quiet: true });

export async function escalate(phone: string, reason: string, context?: Record<string, unknown>): Promise<void> {
  logEvent(phone, "escalation", { reason, context });

  const agentNumber = process.env.AGENT_WHATSAPP_NUMBER;
  if (!agentNumber) {
    console.error(`escalate: AGENT_WHATSAPP_NUMBER not set, could not notify agent. Reason: ${reason}`);
    return;
  }

  const contextLines = context ? Object.entries(context).map(([k, v]) => `${k}: ${v}`).join("\n") : "";

  try {
    await sendWhatsAppMessage({
      to: agentNumber,
      body: `Escalation needed.\nTenant: ${phone}\nReason: ${reason}${contextLines ? `\n${contextLines}` : ""}`,
    });
  } catch (err) {
    console.error("escalate: failed to notify agent via WhatsApp:", err);
  }
}
