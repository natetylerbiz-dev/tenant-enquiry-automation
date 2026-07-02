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
  client = new Anthropic();
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
      property: { type: "string", description: "The property/listing the tenant is enquiring about, or empty string if unclear" },
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
  from: string
): Promise<ExtractedTenantDetails> {
  const response = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_tenant_details" },
    messages: [
      {
        role: "user",
        content: `Extract tenant enquiry details from this email.\n\nFrom: ${from}\nSubject: ${subject}\n\n${body}`,
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
