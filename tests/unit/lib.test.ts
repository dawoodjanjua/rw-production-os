import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import { renderTemplate, waLink } from "@/lib/whatsapp";
import { fromLocalInput, toLocalInput } from "@/lib/format";

describe("phone normalization", () => {
  it("normalizes Pakistani formats to E.164", () => {
    expect(normalizePhone("0300 1234567")).toBe("+923001234567");
    expect(normalizePhone("+92 300 1234567")).toBe("+923001234567");
    expect(normalizePhone("0092-300-1234567")).toBe("+923001234567");
    expect(normalizePhone("")).toBeNull();
    expect(() => normalizePhone("12345")).toThrow();
  });
});

describe("WhatsApp handoff", () => {
  it("builds a wa.me link with the encoded message", () => {
    expect(waLink("+923001234567", "Hi & bye")).toBe("https://wa.me/923001234567?text=Hi%20%26%20bye");
  });
  it("renders templates", () => {
    expect(renderTemplate("Hi {client}, {reference} due {due}.{missing}", { client: "Ali", reference: "RNT-0001", due: "5:00 PM" }))
      .toBe("Hi Ali, RNT-0001 due 5:00 PM.");
  });
});

describe("timezone input conversion", () => {
  it("round-trips Asia/Karachi", () => {
    expect(fromLocalInput("2026-11-02T11:00", "Asia/Karachi")).toBe("2026-11-02T06:00:00.000Z");
    expect(toLocalInput("2026-11-02T06:00:00.000Z", "Asia/Karachi")).toBe("2026-11-02T11:00");
  });
  it("handles DST zones", () => {
    expect(fromLocalInput("2026-07-01T10:00", "America/New_York")).toBe("2026-07-01T14:00:00.000Z");
    expect(fromLocalInput("2026-12-01T10:00", "America/New_York")).toBe("2026-12-01T15:00:00.000Z");
  });
});
