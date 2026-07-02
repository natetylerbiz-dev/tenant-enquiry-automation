import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config({ quiet: true });

const TEMPLATE_BODY =
  "Hi {{1}}, thank you for your enquiry regarding {{2}}.\n\n" +
  "{{3}} will be showing the property on:\n{{4}}\n\n" +
  "Please let us know which of these times would suit you. If none of them work, let us know and we'll arrange another time with {{3}}.\n\n" +
  "If you have any other questions, feel free to ask.";

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN must be set in .env");
  }

  const client = twilio(accountSid, authToken);

  const existing = await client.content.v1.contents.list();
  const match = existing.find((c) => c.friendlyName === "viewing_slots_offer");
  if (match) {
    console.log(`Content Template "viewing_slots_offer" already exists — not creating a duplicate.\n`);
    console.log(`TWILIO_SLOTS_TEMPLATE_SID=${match.sid}`);
    return;
  }

  const content = await client.content.v1.contents.create({
    // The Content API's actual wire format is snake_case (confirmed against
    // Twilio's docs) — the SDK's TS types are camelCase and don't match, same
    // gap as the "twilio/text" key below. `as any` bypasses the (wrong) types.
    friendly_name: "viewing_slots_offer",
    language: "en",
    variables: { "1": "Sipho", "2": "the 2 bedroom apartment in Wilgeheuwel", "3": "Nathan", "4": "1. Monday at 3pm\n2. Wednesday at 11am\n3. Saturday at 4pm" },
    types: {
      "twilio/text": { body: TEMPLATE_BODY },
    },
  } as any);

  console.log("Created Content Template. Add this to your .env file:\n");
  console.log(`TWILIO_SLOTS_TEMPLATE_SID=${content.sid}`);
}

main().catch((err) => {
  console.error("create-slots-template failed:", err.message);
  process.exit(1);
});
