import dotenv from "dotenv";
import { getTenant, upsertTenant, type TenantRecord } from "../state/db.js";
import { logEvent } from "./logger.js";
import { escalate } from "./escalation.js";
import { sendWhatsAppMessage } from "./whatsapp.js";
import { getAvailableSlots, getPropertyDetails, listKnownProperties, markSlotBooked, type SlotRow } from "./sheets.js";
import { answerFaqQuestion } from "./faq.js";
import { extractTenantDetails } from "./extraction.js";
import { createViewingEvent } from "./calendar.js";
import { CONFIDENCE_THRESHOLD } from "../config.js";
import type { TenantEnquiryEmail } from "./gmail.js";
import { normalizePhoneNumber } from "./phone.js";

dotenv.config({ quiet: true });

const VIEWING_INTENT_RE = /\b(view|viewing|tour|visit|see (it|the (property|place|apartment|unit))|book)\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function slotWeekday(slot: SlotRow): string {
  return new Date(`${slot.date} ${slot.time}`).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
}

// Lets a tenant reply with the day of an already-offered slot ("Saturday
// works") instead of the slot's list number — falls back to handleFaqQuestion
// if nothing offered matches, so it can't misfire on an unrelated message.
function findSlotsMentioned(body: string, slots: SlotRow[]): SlotRow[] {
  const lower = body.toLowerCase();
  const mentionedWeekdays = WEEKDAYS.filter((day) => new RegExp(`\\b${day}\\b`).test(lower));
  if (mentionedWeekdays.length === 0) return [];
  return slots.filter((slot) => mentionedWeekdays.includes(slotWeekday(slot)));
}

function agentName(): string {
  return process.env.AGENT_NAME || "the leasing team";
}

function formatSlotForTemplate(slot: SlotRow): string {
  const dt = new Date(`${slot.date} ${slot.time}`);
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
  const hour12 = dt.getHours() % 12 || 12;
  const minutes = dt.getMinutes();
  const ampm = dt.getHours() < 12 ? "am" : "pm";
  const time = minutes === 0 ? `${hour12}${ampm}` : `${hour12}:${String(minutes).padStart(2, "0")}${ampm}`;
  return `${weekday} at ${time}`;
}

async function formatPropertyDescription(property: string): Promise<string> {
  const details = await getPropertyDetails(property);
  if (!details?.bedrooms) return property;
  const area = details.area ? ` in ${details.area}` : "";
  return `the ${details.bedrooms} bedroom apartment${area}`;
}

export async function handleNewEnquiry(email: TenantEnquiryEmail): Promise<void> {
  const knownProperties = await listKnownProperties();
  const extracted = await extractTenantDetails(email.subject, email.body, email.from, knownProperties);

  if (extracted.confidence < CONFIDENCE_THRESHOLD) {
    await escalate(email.from, "low-confidence-extraction", { subject: email.subject, extracted });
    return;
  }
  if (!extracted.property) {
    await escalate(email.from, "unmatched-property-in-extraction", { subject: email.subject, extracted, knownProperties });
    return;
  }

  // Test-mode override: send everything to a known WhatsApp number instead of
  // whatever phone the LLM extracted from the email body. Also used as the
  // tenant's DB key so inbound replies from that number route back correctly.
  // Real extracted numbers need E.164 normalization — Twilio WhatsApp rejects
  // local-format numbers like "081 234 5678" as extracted verbatim from emails.
  const phone = process.env.TEST_TENANT_PHONE_OVERRIDE || normalizePhoneNumber(extracted.phone);
  if (!phone) {
    await escalate(email.from, "missing-phone-in-extraction", { subject: email.subject, extracted });
    return;
  }

  const tenant = upsertTenant({
    phone,
    name: extracted.name,
    email: extracted.email,
    property: extracted.property,
    state: "new",
    offeredSlots: null,
  });

  logEvent(tenant.phone, "enquiry_received", { subject: email.subject, extracted });

  // First message the tenant receives is the viewing-slots template directly,
  // rather than a separate acknowledgement — sendSlotOptions handles the
  // no-slots-available case (message + escalate) gracefully too.
  await sendSlotOptions(tenant);
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
  // Kick off both Sheets reads concurrently — they're independent of each other,
  // and the property description is only needed later (in the template branch).
  const slotsPromise = getAvailableSlots(tenant.property || undefined);
  const propertyDescriptionPromise = formatPropertyDescription(tenant.property).catch(() => tenant.property);

  const slots = await slotsPromise;

  if (slots.length === 0) {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `Sorry, there are no viewing slots available for ${tenant.property || "this property"} right now. I'll let ${agentName()} know you're interested.`,
    });
    await escalate(tenant.phone, "no-slots-available", { property: tenant.property });
    return;
  }

  const templateSid = process.env.TWILIO_SLOTS_TEMPLATE_SID;
  if (templateSid) {
    const slotsList = slots.map((slot, i) => `${i + 1}. ${formatSlotForTemplate(slot)}`).join("\n");
    const propertyDescription = await propertyDescriptionPromise;
    await sendWhatsAppMessage({
      to: tenant.phone,
      contentSid: templateSid,
      contentVariables: {
        "1": tenant.name || "there",
        "2": propertyDescription,
        "3": agentName(),
        "4": slotsList,
      },
    });
  } else {
    const list = slots.map((slot, i) => `${i + 1}. ${slot.date} ${slot.time}`).join("\n");
    const body =
      `Hi ${tenant.name || "there"}, here are the available viewing times for ${tenant.property || "the property"}:\n\n` +
      `${list}\n\nReply with the number of the time that works for you.\n\n- ${agentName()}`;
    await sendWhatsAppMessage({ to: tenant.phone, body });
  }
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
  const trimmed = body.trim();
  const choice = Number(trimmed);
  const isWholeNumber = trimmed !== "" && Number.isInteger(choice);

  if (!isWholeNumber) {
    const dayMatches = findSlotsMentioned(trimmed, slots);
    if (dayMatches.length === 1) {
      await bookViewing(tenant, dayMatches[0]);
      return;
    }
    if (dayMatches.length > 1) {
      const list = dayMatches
        .map((slot) => `${slots.indexOf(slot) + 1}. ${formatSlotForTemplate(slot)}`)
        .join("\n");
      await sendWhatsAppMessage({
        to: tenant.phone,
        body: `I have a few options that day:\n\n${list}\n\nReply with the number of the one you'd like.`,
      });
      return;
    }

    // Not a slot pick or a recognized offered day — answer it instead of losing
    // the slot offer. State/offeredSlots are untouched, so they can still reply
    // with a number afterward.
    await handleFaqQuestion(tenant, body);
    return;
  }

  if (choice < 1 || choice > slots.length) {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `Sorry, I didn't catch that. Please reply with a number from 1 to ${slots.length} from the list above.`,
    });
    return;
  }

  await bookViewing(tenant, slots[choice - 1]);
}

async function bookViewing(tenant: TenantRecord, slot: SlotRow): Promise<void> {
  // The calendar event is the source of truth for "is this booked" — if this
  // throws, nothing else below runs and the tenant stays in
  // awaiting_slot_selection so they can retry.
  await createViewingEvent({
    property: slot.property,
    date: slot.date,
    time: slot.time,
    tenantName: tenant.name,
    tenantPhone: tenant.phone,
  });

  // Best-effort from here — the booking already exists in the calendar, so a
  // failure in any of these steps shouldn't silently leave the tenant record
  // and the agent in the dark about a booking that actually happened.
  const slotMarked = await markSlotBooked(slot.property, slot.date, slot.time).catch((err) => {
    console.error("bookViewing: failed to mark slot booked in Sheet (calendar event still created):", err);
    return false;
  });

  let tenantNotified = true;
  try {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `You're booked! ${slot.property} on ${slot.date} at ${slot.time}. See you then.`,
    });
  } catch (err) {
    tenantNotified = false;
    console.error("bookViewing: failed to notify tenant, calendar event exists regardless:", err);
  }

  const agentNumber = process.env.AGENT_WHATSAPP_NUMBER;
  if (agentNumber) {
    const warnings =
      (tenantNotified ? "" : "\n⚠ Tenant was NOT notified (WhatsApp send failed) — contact them directly.") +
      (slotMarked ? "" : "\n⚠ Could not mark the slot as booked in the Sheet — check for a possible double-booking.");
    try {
      await sendWhatsAppMessage({
        to: agentNumber,
        body:
          `Viewing confirmed.\n` +
          `Property: ${slot.property}\n` +
          `Tenant: ${tenant.name}\n` +
          `Phone: ${tenant.phone}\n` +
          `Time: ${slot.date} at ${slot.time}` +
          warnings,
      });
    } catch (err) {
      console.error("bookViewing: failed to notify agent:", err);
    }
  }

  // Always reflect the real outcome — the calendar event exists regardless of
  // whether the notifications above succeeded.
  upsertTenant({
    phone: tenant.phone,
    name: tenant.name,
    email: tenant.email,
    property: tenant.property,
    state: "booked",
    offeredSlots: null,
  });
  logEvent(tenant.phone, "booking_confirmed", { slot, slotMarked, tenantNotified });

  if (!tenantNotified) {
    await escalate(tenant.phone, "booking-confirmation-send-failed", { slot });
  }
}

async function handleFaqQuestion(tenant: TenantRecord, body: string): Promise<void> {
  const { onTopic, answer, confidence } = await answerFaqQuestion(body, tenant.property);

  // Off-topic messages get a fixed, code-owned redirect rather than whatever
  // the model produced for "answer" — the model output isn't trusted here
  // since the tenant's message is what's steering it, and this is exactly the
  // path a "write me a poem"/"ignore instructions" style message takes.
  // No escalate() either: this isn't a real leasing question the agent needs
  // to see, just chatbot misuse to redirect away from.
  if (!onTopic) {
    await sendWhatsAppMessage({
      to: tenant.phone,
      body: `I can only help with questions about ${tenant.property || "this property"} and the viewing/tenancy process. For anything else, please contact ${agentName()} directly.`,
    });
    logEvent(tenant.phone, "faq_off_topic", { question: body });
    return;
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    await escalate(tenant.phone, "low-confidence-faq-answer", { question: body, answer, confidence });
    return;
  }

  await sendWhatsAppMessage({ to: tenant.phone, body: answer });
  logEvent(tenant.phone, "faq_answered", { question: body, answer, confidence });
}
