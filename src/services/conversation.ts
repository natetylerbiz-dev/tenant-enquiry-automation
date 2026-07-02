import dotenv from "dotenv";
import { getTenant, upsertTenant, type TenantRecord } from "../state/db.js";
import { logEvent } from "./logger.js";
import { escalate } from "./escalation.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import { getAvailableSlots, type SlotRow } from "./sheets.js";
import { answerFaqQuestion } from "./faq.js";
import { extractTenantDetails } from "./extraction.js";
import { createViewingEvent } from "./calendar.js";
import { CONFIDENCE_THRESHOLD } from "../config.js";
import type { TenantEnquiryEmail } from "./gmail.js";

dotenv.config({ quiet: true });

const VIEWING_INTENT_RE = /\b(view|viewing|tour|visit|see (it|the (property|place|apartment|unit))|book)\b/i;

function agentName(): string {
  return process.env.AGENT_NAME || "the leasing team";
}

export async function handleNewEnquiry(email: TenantEnquiryEmail): Promise<void> {
  const extracted = await extractTenantDetails(email.subject, email.body, email.from);

  if (extracted.confidence < CONFIDENCE_THRESHOLD) {
    await escalate(email.from, "low-confidence-extraction", { subject: email.subject, extracted });
    return;
  }
  if (!extracted.phone) {
    await escalate(email.from, "missing-phone-in-extraction", { subject: email.subject, extracted });
    return;
  }

  const tenant = upsertTenant({
    phone: extracted.phone,
    name: extracted.name,
    email: extracted.email,
    property: extracted.property,
    state: "new",
    offeredSlots: null,
  });

  logEvent(tenant.phone, "enquiry_received", { subject: email.subject, extracted });

  await sendWhatsAppMessage({
    to: tenant.phone,
    body:
      `Hi ${tenant.name || "there"}, thanks for your enquiry about ${tenant.property || "the property"}. ` +
      `I'm ${agentName()}. Ask me anything, or reply "viewing" to see available times.`,
  });
  logEvent(tenant.phone, "acknowledgement_sent", {});
}

export async function handleTenantReply(phone: string, body: string): Promise<void> {
  logEvent(phone, "tenant_message", { body });

  const tenant = getTenant(phone);
  if (!tenant) {
    await escalate(phone, "message-from-unknown-tenant", { body });
    return;
  }

  if (tenant.state === "awaiting_slot_selection") {
    await handleSlotSelection(tenant, body);
    return;
  }

  if (VIEWING_INTENT_RE.test(body)) {
    await sendSlotOptions(tenant);
    return;
  }

  await handleFaqQuestion(tenant, body);
}

async function sendSlotOptions(tenant: TenantRecord): Promise<void> {
  const slots = await getAvailableSlots(tenant.property || undefined);

  if (slots.length === 0) {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `Sorry, there are no viewing slots available for ${tenant.property || "this property"} right now. I'll let ${agentName()} know you're interested.`,
    });
    await escalate(tenant.phone, "no-slots-available", { property: tenant.property });
    return;
  }

  const list = slots.map((slot, i) => `${i + 1}. ${slot.date} ${slot.time}`).join("\n");
  const body =
    `Hi ${tenant.name || "there"}, here are the available viewing times for ${tenant.property || "the property"}:\n\n` +
    `${list}\n\nReply with the number of the time that works for you.\n\n- ${agentName()}`;

  await sendWhatsAppMessage({ to: tenant.phone, body });
  upsertTenant({
    phone: tenant.phone,
    name: tenant.name,
    email: tenant.email,
    property: tenant.property,
    state: "awaiting_slot_selection",
    offeredSlots: JSON.stringify(slots),
  });
  logEvent(tenant.phone, "slots_sent", { slots });
}

async function handleSlotSelection(tenant: TenantRecord, body: string): Promise<void> {
  const slots: SlotRow[] = tenant.offeredSlots ? JSON.parse(tenant.offeredSlots) : [];
  const choice = parseInt(body.trim(), 10);

  if (!Number.isInteger(choice) || choice < 1 || choice > slots.length) {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `Sorry, I didn't catch that. Please reply with a number from 1 to ${slots.length} from the list above.`,
    });
    return;
  }

  await bookViewing(tenant, slots[choice - 1]);
}

async function bookViewing(tenant: TenantRecord, slot: SlotRow): Promise<void> {
  await createViewingEvent({
    property: slot.property,
    date: slot.date,
    time: slot.time,
    tenantName: tenant.name,
    tenantPhone: tenant.phone,
  });

  await sendWhatsAppMessage({
    to: tenant.phone,
    body: `You're booked! ${slot.property} on ${slot.date} at ${slot.time}. See you then.`,
  });

  const agentNumber = process.env.AGENT_WHATSAPP_NUMBER;
  if (agentNumber) {
    await sendWhatsAppMessage({
      to: agentNumber,
      body: `New viewing booked: ${tenant.name} (${tenant.phone}) — ${slot.property} on ${slot.date} at ${slot.time}.`,
    });
  }

  upsertTenant({
    phone: tenant.phone,
    name: tenant.name,
    email: tenant.email,
    property: tenant.property,
    state: "booked",
    offeredSlots: null,
  });
  logEvent(tenant.phone, "booking_confirmed", { slot });
}

async function handleFaqQuestion(tenant: TenantRecord, body: string): Promise<void> {
  const { answer, confidence } = await answerFaqQuestion(body, tenant.property);

  if (confidence < CONFIDENCE_THRESHOLD) {
    await escalate(tenant.phone, "low-confidence-faq-answer", { question: body, answer, confidence });
    return;
  }

  await sendWhatsAppMessage({ to: tenant.phone, body: answer });
  logEvent(tenant.phone, "faq_answered", { question: body, answer, confidence });
}
