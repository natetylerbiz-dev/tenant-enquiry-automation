import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

const SHEET_RANGE = "Sheet1!A2:E";

export interface SlotRow {
  property: string;
  date: string;
  time: string;
  status: string;
  agent: string;
}

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyFile) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in the environment");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function getAvailableSlots(property?: string): Promise<SlotRow[]> {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEETS_ID is not set in the environment");
  }

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row): SlotRow => ({
      property: row[0] ?? "",
      date: row[1] ?? "",
      time: row[2] ?? "",
      status: row[3] ?? "",
      agent: row[4] ?? "",
    }))
    .filter((row) => row.status === "Available")
    .filter((row) => !property || row.property === property);
}
