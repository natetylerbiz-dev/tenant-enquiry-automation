import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ quiet: true });

export interface ExtractedTenantDetails {
  name: string;
  phone: string;
  email: string;
  property: string;
  message: string;
  confidence: number;
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client) return client;
  // Default SDK timeout is 10 minutes — far too long for a WhatsApp-response flow.
  // A hung request with no timeout blocks the poller silently, with no error and
  // no reply ever sent, so bound it tightly instead.
  client = new Anthropic({ timeout: 30_000 });
  return client;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_tenant_details",
  description:
    "Record the tenant details extracted from an inbound enquiry email.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Tenant's full name, or empty string if not stated" },
      phone: { type: "string", description: "Tenant's phone number, or empty string if not stated" },
      email: { type: "string", description: "Tenant's email address, or empty string if not stated" },
      property: {
        type: "string",
        description:
          "The property being enquired about, matched EXACTLY (character for character) to one of the known property names provided. " +
          "Source emails (e.g. property portals) often describe the listing in their own marketing wording with extra details like " +
          "web references - do not use that wording. If you cannot confidently match the enquiry to one of the known property names, " +
          "leave this as an empty string rather than guessing or inventing a name.",
      },
      message: { type: "string", description: "A short summary of what the tenant is asking for" },
      confidence: {
        type: "number",
        description: "0 to 1: how confident the extraction is that name/phone/email/property were correctly identified from this email",
      },
    },
    required: ["name", "phone", "email", "property", "message", "confidence"],
    additionalProperties: false,
  },
};

export async function extractTenantDetails(
  subject: string,
  body: string,
  from: string,
  knownProperties: string[] = []
): Promise<ExtractedTenantDetails> {
  const propertyList =
    knownProperties.length > 0
      ? `Known property names (the "property" field must exactly match one of these, or be left empty):\n${knownProperties.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";

  const response = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_tenant_details" },
    messages: [
      {
        role: "user",
        content: `Extract tenant enquiry details from this email.\n\n${propertyList}From: ${from}\nSubject: ${subject}\n\n${body}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("extractTenantDetails: model did not return a tool_use block");
  }

  return toolUse.input as ExtractedTenantDetails;
}
