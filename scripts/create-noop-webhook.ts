import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config({ quiet: true });

const FLOW_DEFINITION = {
  description: "No-op flow: silently absorbs inbound WhatsApp Sandbox messages so Twilio doesn't auto-reply.",
  states: [
    {
      name: "Trigger",
      type: "trigger",
      transitions: [{ event: "incomingMessage" }, { event: "incomingCall" }, { event: "incomingRequest" }],
      properties: { offset: { x: 0, y: 0 } },
    },
  ],
  initial_state: "Trigger",
  flags: { allow_concurrent_calls: true },
};

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN must be set in .env");
  }

  const client = twilio(accountSid, authToken);

  const existingFlows = await client.studio.v2.flows.list();
  const match = existingFlows.find((f) => f.friendlyName === "sandbox-noop-webhook");
  if (match) {
    console.log(`Flow "sandbox-noop-webhook" already exists — not creating a duplicate.\n`);
    console.log(`https://webhooks.twilio.com/v1/Accounts/${accountSid}/Flows/${match.sid}`);
    return;
  }

  console.log("Validating flow definition...");
  const validation = await client.studio.v2.flowValidate.update({
    friendlyName: "sandbox-noop-webhook",
    status: "published",
    definition: FLOW_DEFINITION,
  });

  if (!validation.valid) {
    console.error("Flow definition is invalid:", JSON.stringify(validation, null, 2));
    process.exit(1);
  }
  console.log("Definition is valid. Creating flow...");

  const flow = await client.studio.v2.flows.create({
    friendlyName: "sandbox-noop-webhook",
    status: "published",
    definition: FLOW_DEFINITION,
  });

  const webhookUrl = `https://webhooks.twilio.com/v1/Accounts/${accountSid}/Flows/${flow.sid}`;
  console.log("\nCreated. Flow SID:", flow.sid);
  console.log("\nWebhook URL to paste into the Sandbox's 'When a message comes in' field:\n");
  console.log(webhookUrl);
}

main().catch((err) => {
  console.error("create-noop-webhook failed:", err.message);
  process.exit(1);
});
