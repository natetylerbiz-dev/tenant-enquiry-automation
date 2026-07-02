import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config({ quiet: true });

let client: twilio.Twilio | undefined;

export function getTwilioClient(): twilio.Twilio {
  if (client) return client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set in the environment");
  }

  client = twilio(accountSid, authToken);
  return client;
}

export function toWhatsAppAddress(numberOrAddress: string): string {
  return numberOrAddress.startsWith("whatsapp:") ? numberOrAddress : `whatsapp:${numberOrAddress}`;
}

export function stripWhatsAppPrefix(address: string): string {
  return address.startsWith("whatsapp:") ? address.slice("whatsapp:".length) : address;
}

export interface SendWhatsAppMessageOptions {
  to: string;
  /** Plain text body. Works in the Twilio Sandbox and within an open 24h session window. */
  body?: string;
  /** Approved Content API template SID, for business-initiated messages outside a session window. */
  contentSid?: string;
  contentVariables?: Record<string, string>;
}

export async function sendWhatsAppMessage(options: SendWhatsAppMessageOptions): Promise<string> {
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) {
    throw new Error("TWILIO_WHATSAPP_NUMBER is not set in the environment");
  }
  if (!options.body && !options.contentSid) {
    throw new Error("sendWhatsAppMessage requires either body or contentSid");
  }

  const message = await getTwilioClient().messages.create({
    from: toWhatsAppAddress(from),
    to: toWhatsAppAddress(options.to),
    ...(options.body ? { body: options.body } : {}),
    ...(options.contentSid ? { contentSid: options.contentSid } : {}),
    ...(options.contentVariables ? { contentVariables: JSON.stringify(options.contentVariables) } : {}),
  });

  return message.sid;
}
