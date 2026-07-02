import dotenv from "dotenv";
import { getTwilioClient, toWhatsAppAddress, stripWhatsAppPrefix } from "./whatsapp.js";

dotenv.config({ quiet: true });

export type TenantMessageHandler = (phone: string, body: string) => Promise<void>;

export function startTwilioPolling(onMessage: TenantMessageHandler): NodeJS.Timeout {
  const intervalMs = Number(process.env.TWILIO_POLL_INTERVAL_MS ?? 15000);
  const seenSids = new Set<string>();
  let lastPolledAt = new Date();

  const poll = async () => {
    const to = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!to) {
      console.error("twilioPoller: TWILIO_WHATSAPP_NUMBER is not set in the environment");
      return;
    }

    const sinceLastPoll = lastPolledAt;
    lastPolledAt = new Date();

    let messages;
    try {
      messages = await getTwilioClient().messages.list({
        to: toWhatsAppAddress(to),
        dateSentAfter: sinceLastPoll,
      });
    } catch (err) {
      console.error("twilioPoller: failed to list messages:", err);
      return;
    }

    for (const message of messages) {
      if (message.direction !== "inbound") continue;
      if (seenSids.has(message.sid)) continue;
      seenSids.add(message.sid);

      try {
        await onMessage(stripWhatsAppPrefix(message.from), message.body);
      } catch (err) {
        console.error(`twilioPoller: failed to process message ${message.sid}:`, err);
      }
    }
  };

  const timer = setInterval(poll, intervalMs);
  poll();
  return timer;
}
