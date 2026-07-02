import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

const SHEET_RANGE = "Sheet1!A2:E";
const PROPERTIES_SHEET_RANGE = "Properties!A2:L";

export interface SlotRow {
  property: string;
  date: string;
  time: string;
  status: string;
  agent: string;
}

export interface PropertyDetails {
  property: string;
  leaseType: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  petFriendly: string;
  parking: string;
  rent: string;
  deposit: string;
  adminFee: string;
  description: string;
  notes: string;
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

// Separate write-scoped client, used only by markSlotBooked — the poller's
// regular reads stay read-only (least privilege); only the one booking write
// path needs the broader scope.
async function getSheetsWriteClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyFile) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in the environment");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
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

export async function listKnownProperties(): Promise<string[]> {
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
  const names = new Set<string>();
  for (const row of rows) {
    if (row[0]) names.add(row[0]);
  }

  return Array.from(names);
}

// Marks a slot as booked so it can't be double-booked by a second tenant.
// Returns false (rather than throwing) if the row can't be found/already
// isn't Available — the caller treats that as "couldn't confirm, flag it"
// rather than a hard failure, since the calendar event is the source of truth.
export async function markSlotBooked(property: string, date: string, time: string): Promise<boolean> {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEETS_ID is not set in the environment");
  }

  const sheets = await getSheetsWriteClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
  });
  const rows = res.data.values ?? [];

  const rowIndex = rows.findIndex(
    (row) => row[0] === property && row[1] === date && row[2] === time && row[3] === "Available"
  );
  if (rowIndex === -1) return false;

  const sheetRowNumber = rowIndex + 2; // SHEET_RANGE starts at row 2
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Sheet1!D${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [["Booked"]] },
  });

  return true;
}

export async function getPropertyDetails(property: string): Promise<PropertyDetails | undefined> {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEETS_ID is not set in the environment");
  }

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: PROPERTIES_SHEET_RANGE,
  });

  const rows = res.data.values ?? [];

  const match = rows.find((row) => row[0] === property);
  if (!match) return undefined;

  return {
    property: match[0] ?? "",
    leaseType: match[1] ?? "",
    area: match[2] ?? "",
    bedrooms: match[3] ?? "",
    bathrooms: match[4] ?? "",
    petFriendly: match[5] ?? "",
    parking: match[6] ?? "",
    rent: match[7] ?? "",
    deposit: match[8] ?? "",
    adminFee: match[9] ?? "",
    description: match[10] ?? "",
    notes: match[11] ?? "",
  };
}
