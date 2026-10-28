import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Normalize a phone number to E.164 (+923001234567). Local Pakistani numbers (0300…) are assumed by default. */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = "PK"): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^00/, "+");
  const p = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!p || !p.isValid()) throw new Error(`"${raw}" is not a valid phone number`);
  return p.number;
}

export function displayPhone(e164: string | null | undefined) {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}
