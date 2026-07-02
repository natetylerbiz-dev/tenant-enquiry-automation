import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

function buildGmailQuery(): string {
  const parts = ['is:unread', '(subject:"Listing Enquiry" OR subject:"Contact Request")'];
  if (process.env.GMAIL_ENQUIRY_FROM) parts.push(`from:${process.env.GMAIL_ENQUIRY_FROM}`);
  if (process.env.GMAIL_ENQUIRY_TO) parts.push(`to:${process.env.GMAIL_ENQUIRY_TO}`);
  return parts.join(' ');
}

export interface TenantEnquiryEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN are not set in the environment. Run `npm run gmail:authorize` first."
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function getGmailClient() {
  return google.gmail({ version: "v1", auth: getOAuthClient() });
}

function decodeBody(payload: import("googleapis").gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }

  for (const part of payload.parts ?? []) {
    const text = decodeBody(part);
    if (text) return text;
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }

  return "";
}

function headerValue(headers: import("googleapis").gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function listUnreadEnquiries(): Promise<TenantEnquiryEmail[]> {
  const gmail = getGmailClient();

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: buildGmailQuery(),
  });

  const messages = listRes.data.messages ?? [];
  const enquiries: TenantEnquiryEmail[] = [];

  for (const { id } of messages) {
    if (!id) continue;

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const headers = msgRes.data.payload?.headers ?? undefined;
    enquiries.push({
      id,
      from: headerValue(headers, "From"),
      subject: headerValue(headers, "Subject"),
      body: decodeBody(msgRes.data.payload ?? undefined),
    });
  }

  return enquiries;
}

export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}
