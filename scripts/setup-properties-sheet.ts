import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

const SHEET_NAME = "Properties";
const HEADERS = [
  "Property",
  "Lease Type",
  "Area",
  "Bedrooms",
  "Bathrooms",
  "Pet Friendly",
  "Parking",
  "Rent",
  "Deposit",
  "Admin Fee",
  "Description",
  "Notes",
];
const EXAMPLE_ROW = [
  "123 Example St",
  "OF",
  "PLACEHOLDER — e.g. Sandton",
  "2",
  "1",
  "No",
  "One off-street parking space",
  "R22,000",
  "R22,000",
  "R950 + VAT",
  "2-bedroom, 1-bath apartment, 850 sq ft, second floor, no elevator",
  "PLACEHOLDER ROW — edit or delete. Property name must match the Slots sheet exactly.",
];

async function main() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!keyFile || !spreadsheetId) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_PATH / GOOGLE_SHEETS_ID must be set in .env");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const existing = await sheets.spreadsheets.get({ spreadsheetId });
  const alreadyExists = existing.data.sheets?.some((s) => s.properties?.title === SHEET_NAME);

  if (alreadyExists) {
    console.log(`Sheet "${SHEET_NAME}" already exists — leaving it untouched. Delete it manually first if you want this script to recreate it.`);
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS, EXAMPLE_ROW] },
  });

  console.log(`Created "${SHEET_NAME}" tab with header row and one placeholder example row at row 2.`);
  console.log("Add real property rows starting at row 2 — the 'Property' column must match the Slots sheet's property names exactly.");
}

main().catch((err) => {
  console.error("setup-properties-sheet failed:", err.message);
  process.exit(1);
});
