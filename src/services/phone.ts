// South Africa — matches this business's context (all properties, currency,
// and lease terms are South African). Numbers with no recognizable country
// prefix are assumed to be local SA numbers.
const DEFAULT_COUNTRY_CODE = "+27";

export function normalizePhoneNumber(raw: string): string {
  const digitsAndPlus = raw.trim().replace(/[^\d+]/g, "");
  if (!digitsAndPlus) return "";

  if (digitsAndPlus.startsWith("+")) return digitsAndPlus;
  if (digitsAndPlus.startsWith("0")) return DEFAULT_COUNTRY_CODE + digitsAndPlus.slice(1);
  if (digitsAndPlus.startsWith("27")) return `+${digitsAndPlus}`;

  return DEFAULT_COUNTRY_CODE + digitsAndPlus;
}

// E.164: a leading + not followed by 0, then 7-14 more digits (8-15 digits total).
// normalizePhoneNumber only reformats — it doesn't reject a source number that's
// too short/long/garbled (e.g. an OCR'd or partially-redacted number in an
// email), so this catches those before a WhatsApp send is even attempted.
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isValidPhoneNumber(normalized: string): boolean {
  return E164_RE.test(normalized);
}
