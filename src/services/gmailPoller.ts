import dotenv from "dotenv";
import { listUnreadEnquiries, markAsRead, type TenantEnquiryEmail } from "./gmail.js";
import { withTimeout } from "./timeout.js";

dotenv.config({ quiet: true });

export type EnquiryHandler = (email: TenantEnquiryEmail) => Promise<void>;

// See twilioPoller.ts for why this exists — silence and a stuck loop look
// identical without it. ~5 minutes at the default 60s interval.
const HEARTBEAT_EVERY_N_TICKS = 5;

export function startGmailPolling(onEnquiry: EnquiryHandler): NodeJS.Timeout {
  const intervalMs = Number(process.env.GMAIL_POLL_INTERVAL_MS ?? 60000);
  let tickCount = 0;
  let isPolling = false;

  const poll = async () => {
    // See twilioPoller.ts — without this guard, an overlapping tick could fetch
    // the same still-unread email before the in-flight cycle marks it read,
    // processing (and messaging) it twice.
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
      console.log(`gmailPoller: heartbeat — tick #${tickCount}, still polling`);
    }

    let enquiries: TenantEnquiryEmail[];
    try {
      enquiries = await listUnreadEnquiries();
    } catch (err) {
      console.error("gmailPoller: failed to list unread enquiries:", err);
      return;
    }

    for (const email of enquiries) {
      try {
        await withTimeout(onEnquiry(email), 60_000, `onEnquiry(${email.id})`);
        await markAsRead(email.id);
      } catch (err) {
        console.error(`gmailPoller: failed to process message ${email.id}:`, err);
      }
    }
  };

  const timer = setInterval(poll, intervalMs);
  poll();
  return timer;
}
