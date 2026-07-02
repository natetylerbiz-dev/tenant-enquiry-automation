import dotenv from "dotenv";
import { getTwilioClient, toWhatsAppAddress, stripWhatsAppPrefix } from "./whatsapp.js";
import { withTimeout } from "./timeout.js";

dotenv.config({ quiet: true });

export type TenantMessageHandler = (phone: string, body: string) => Promise<void>;

// Bounds memory for a long-running process — only the last poll or two of SIDs
// actually need deduping against, since the watermark already excludes older
// messages from being re-fetched at all.
const MAX_SEEN_SIDS = 1000;

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

    // Only advance the watermark once the fetch actually succeeds — otherwise a
    // transient failure (network blip, DNS hiccup) would silently skip whatever
    // messages arrived during the outage on the next successful poll.
    const attemptStartedAt = new Date();
    let messages;
    try {
      messages = await getTwilioClient().messages.list({
        to: toWhatsAppAddress(to),
        dateSentAfter: lastPolledAt,
      });
    } catch (err) {
      console.error("twilioPoller: failed to list messages:", err);
      return;
    }
    lastPolledAt = attemptStartedAt;

    for (const message of messages) {
      if (message.direction !== "inbound") continue;
      if (seenSids.has(message.sid)) continue;
      seenSids.add(message.sid);
      if (seenSids.size > MAX_SEEN_SIDS) {
        const recent = Array.from(seenSids).slice(-MAX_SEEN_SIDS / 2);
        seenSids.clear();
        for (const sid of recent) seenSids.add(sid);
      }

      try {
        await withTimeout(
          onMessage(stripWhatsAppPrefix(message.from), message.body),
          60_000,
          `onMessage(${message.sid})`
        );
      } catch (err) {
        console.error(`twilioPoller: failed to process message ${message.sid}:`, err);
      }
    }
  };

  const timer = setInterval(poll, intervalMs);
  poll();
  return timer;
}
