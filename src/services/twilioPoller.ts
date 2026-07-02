import dotenv from "dotenv";
import { getTwilioClient, toWhatsAppAddress, stripWhatsAppPrefix } from "./whatsapp.js";
import { withTimeout } from "./timeout.js";

dotenv.config({ quiet: true });

export type TenantMessageHandler = (phone: string, body: string) => Promise<void>;

// Bounds memory for a long-running process — only the messages inside the
// lookback window can ever be re-fetched, so older SIDs are safe to forget.
const MAX_SEEN_SIDS = 1000;

// Proof-of-life logging — with no heartbeat, "no new messages" and "the loop
// silently stopped ticking" look identical from the log alone, which made a
// real stuck-process incident hard to diagnose. ~60s at the default interval.
const HEARTBEAT_EVERY_N_TICKS = 20;

// Query a fixed rolling window every cycle instead of an advancing "since last
// success" watermark. An advancing watermark assumes a message is queryable
// via dateSentAfter as soon as it's sent — but Twilio's Messages List API has
// indexing lag, so a message can still not be returned for a few seconds after
// its own dateSent timestamp. With an advancing watermark, once the watermark
// passes that timestamp the message is permanently excluded even though it
// existed the whole time — a real, observed message loss, not a hypothetical.
// A fixed lookback can't have this failure mode: every message stays inside
// the query window for LOOKBACK_MS regardless of when it becomes indexed.
// seenSids does the dedup work that an advancing watermark used to do.
const LOOKBACK_MS = 30_000;

export function startTwilioPolling(onMessage: TenantMessageHandler): NodeJS.Timeout {
  const intervalMs = Number(process.env.TWILIO_POLL_INTERVAL_MS ?? 15000);
  const seenSids = new Set<string>();
  let tickCount = 0;
  let isPolling = false;

  const poll = async () => {
    // setInterval fires on a fixed schedule regardless of whether the previous
    // poll() call has finished — with a short interval and processing
    // (extraction/FAQ/send) that can take several seconds, overlapping
    // invocations would race on shared state with no coordination. Skipping a
    // tick while one is already in flight is safe: nothing is lost, the next
    // unskipped cycle's lookback window still covers the gap.
    if (isPolling) return;
    isPolling = true;
    try {
      await pollOnce();
    } finally {
      isPolling = false;
    }
  };

  const pollOnce = async () => {
    tickCount++;
    if (tickCount % HEARTBEAT_EVERY_N_TICKS === 0) {
      console.log(`twilioPoller: heartbeat — tick #${tickCount}, still polling`);
    }

    const to = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!to) {
      console.error("twilioPoller: TWILIO_WHATSAPP_NUMBER is not set in the environment");
      return;
    }

    let messages;
    try {
      messages = await getTwilioClient().messages.list({
        to: toWhatsAppAddress(to),
        dateSentAfter: new Date(Date.now() - LOOKBACK_MS),
      });
    } catch (err) {
      console.error("twilioPoller: failed to list messages:", err);
      return;
    }

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
