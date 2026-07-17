import dotenv from "dotenv";
import { getDb } from "./state/db.js";
import { acquireInstanceLock } from "./services/instanceLock.js";
import { startGmailPolling } from "./services/gmailPoller.js";
import { startTwilioPolling } from "./services/twilioPoller.js";
import { handleNewEnquiry, handleTenantReply } from "./services/conversation.js";

dotenv.config({ quiet: true });

acquireInstanceLock();

// Both pollers already catch and log errors per-message, so anything reaching
// here slipped past every safety net. Log it clearly rather than dying with no
// trace. unhandledRejection is logged but non-fatal — an async error that
// escaped a poller's own try/catch shouldn't take the whole service down mid-
// conversation. uncaughtException means a synchronous throw left the process
// in an undefined state (Node's own guidance: don't try to resume from this),
// so that one exits after logging.
process.on("unhandledRejection", (reason) => {
  console.error("FATAL-CANDIDATE unhandledRejection (continuing to run):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("FATAL uncaughtException, exiting:", err);
  process.exit(1);
});

getDb();

startGmailPolling(handleNewEnquiry);
startTwilioPolling(handleTenantReply);

console.log("tenant-enquiry-automation: polling Gmail and Twilio");
