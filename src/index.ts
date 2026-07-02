import dotenv from "dotenv";
import { getDb } from "./state/db.js";
import { startGmailPolling } from "./services/gmailPoller.js";
import { startTwilioPolling } from "./services/twilioPoller.js";
import { handleNewEnquiry, handleTenantReply } from "./services/conversation.js";

dotenv.config({ quiet: true });

getDb();

startGmailPolling(handleNewEnquiry);
startTwilioPolling(handleTenantReply);

console.log("tenant-enquiry-automation: polling Gmail and Twilio");
