import dotenv from "dotenv";
import { listUnreadEnquiries, markAsRead, type TenantEnquiryEmail } from "./gmail.js";
import { withTimeout } from "./timeout.js";

dotenv.config({ quiet: true });

export type EnquiryHandler = (email: TenantEnquiryEmail) => Promise<void>;

export function startGmailPolling(onEnquiry: EnquiryHandler): NodeJS.Timeout {
  const intervalMs = Number(process.env.GMAIL_POLL_INTERVAL_MS ?? 60000);

  const poll = async () => {
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
