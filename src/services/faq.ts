import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ quiet: true });

const FAQ_DATA_PATH = path.join(process.cwd(), "data", "property-faq.json");

interface PropertyFaqEntry {
  description: string;
  faq: string[];
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client) return client;
  client = new Anthropic();
  return client;
}

function loadPropertyContext(property: string): string {
  const raw = fs.readFileSync(FAQ_DATA_PATH, "utf8");
  const data = JSON.parse(raw) as Record<string, PropertyFaqEntry | string>;

  const generic = data.generic as PropertyFaqEntry | undefined;
  const specific = data[property] as PropertyFaqEntry | undefined;

  const sections: string[] = [];
  if (generic) {
    sections.push(`General policies:\n${generic.faq.map((line) => `- ${line}`).join("\n")}`);
  }
  if (specific) {
    sections.push(
      `${property}:\n${specific.description}\n${specific.faq.map((line) => `- ${line}`).join("\n")}`
    );
  }

  return sections.join("\n\n") || "No property information available.";
}

export interface FaqAnswer {
  answer: string;
  confidence: number;
}

const FAQ_TOOL: Anthropic.Tool = {
  name: "answer_question",
  description: "Record the answer to a tenant's question, along with a confidence score.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "A direct, concise answer to the tenant's question, grounded only in the provided property information.",
      },
      confidence: {
        type: "number",
        description: "0 to 1: how confident this answer is fully and correctly supported by the provided property information.",
      },
    },
    required: ["answer", "confidence"],
    additionalProperties: false,
  },
};

export async function answerFaqQuestion(question: string, property: string): Promise<FaqAnswer> {
  const context = loadPropertyContext(property);

  const response = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    system:
      "You answer tenant questions about a rental property using only the information provided below. " +
      "If the information doesn't cover the question, still answer as best you can but set confidence low rather than guessing.",
    tools: [FAQ_TOOL],
    tool_choice: { type: "tool", name: "answer_question" },
    messages: [
      {
        role: "user",
        content: `Property information:\n${context}\n\nTenant question: ${question}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("answerFaqQuestion: model did not return a tool_use block");
  }

  return toolUse.input as FaqAnswer;
}
