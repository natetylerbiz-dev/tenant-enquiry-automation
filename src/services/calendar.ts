import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

async function getCalendarClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyFile) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in the environment");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  });

  return google.calendar({ version: "v3", auth });
}

export interface ViewingBooking {
  property: string;
  date: string;
  time: string;
  tenantName: string;
  tenantPhone: string;
}

export async function createViewingEvent(booking: ViewingBooking): Promise<string> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID is not set in the environment");
  }

  const calendar = await getCalendarClient();
  const start = new Date(`${booking.date} ${booking.time}`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Viewing: ${booking.property} — ${booking.tenantName}`,
      description: `Tenant: ${booking.tenantName}\nPhone: ${booking.tenantPhone}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  if (!res.data.id) {
    throw new Error("createViewingEvent: Calendar API did not return an event id");
  }

  return res.data.id;
}
