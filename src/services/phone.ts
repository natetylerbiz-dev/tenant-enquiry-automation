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
