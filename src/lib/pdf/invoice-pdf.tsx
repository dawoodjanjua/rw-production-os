import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { BillTo, Company } from "@/lib/invoice-data";
import { displayPhone } from "@/lib/phone";

type Props = {
  inv: { number: string; issue_date: string; due_date: string; currency: string; subtotal: number; discount_amount: number; tax_rate: number; tax_amount: number; total: number; amount_paid: number; balance: number; display_status: string; project_name: string | null; rental_reference: string | null; payment_instructions: string | null; notes: string | null };
  items: { description: string; quantity: number; unit_price: number; amount: number }[];
  payments: { amount: number; paid_at: string; method: string; reference: string | null }[];
  client: BillTo; company: Company; brand: string; logo: { data: Buffer; format: "png" | "jpg" } | null; tz: string;
};

const m = (n: number | string, c: string) => `${c} ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const d = (s: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s));
const STATUS: Record<string, string> = { draft: "DRAFT", issued: "UNPAID", partially_paid: "PARTIALLY PAID", paid: "PAID", overdue: "OVERDUE", void: "VOID" };

export function InvoicePdf({ inv, items, payments, client, company, brand, logo, tz }: Props) {
  const s = StyleSheet.create({
    page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#17201b" },
    bar: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: brand },
    row: { flexDirection: "row" },
    muted: { color: "#69736d" },
    label: { fontSize: 7.5, color: "#69736d", letterSpacing: 1, fontFamily: "Helvetica-Bold", marginBottom: 3 },
    th: { fontSize: 7.5, color: "#69736d", fontFamily: "Helvetica-Bold", letterSpacing: 0.8, paddingVertical: 6 },
    td: { paddingVertical: 6 },
  });
  const cur = inv.currency;
  return (
    <Document title={`Invoice ${inv.number}`} author={company.company_name}>
      <Page size="A4" style={s.page}>
        <View style={s.bar} fixed />
        <View style={[s.row, { justifyContent: "space-between", marginTop: 6 }]}>
          <View style={[s.row, { gap: 12, maxWidth: 320 }]}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo && <Image src={logo} style={{ width: 52, height: 52, objectFit: "contain" }} />}
            <View>
              <Text style={{ fontSize: 15, fontFamily: "Helvetica-Bold", color: brand, textTransform: "uppercase" }}>{company.company_name}</Text>
              {company.tagline ? <Text style={[s.muted, { fontSize: 7.5, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 2 }]}>{company.tagline}</Text> : null}
              {company.address ? <Text style={[s.muted, { marginTop: 6 }]}>{company.address}</Text> : null}
              <Text style={s.muted}>{[displayPhone(company.phone), company.email, company.website].filter(Boolean).join("  ·  ")}</Text>
              {company.ntn ? <Text style={s.muted}>NTN: {company.ntn}</Text> : null}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 20, letterSpacing: 4, color: "#69736d" }}>INVOICE</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 3 }}>{inv.number}</Text>
            <Text style={[s.muted, { marginTop: 6 }]}>Issued {d(inv.issue_date)}</Text>
            <Text style={s.muted}>Due {d(inv.due_date)}</Text>
            <Text style={{ marginTop: 6, fontFamily: "Helvetica-Bold", color: inv.display_status === "paid" ? "#047857" : inv.display_status === "overdue" ? "#b91c1c" : brand }}>{STATUS[inv.display_status] ?? inv.display_status.toUpperCase()}</Text>
          </View>
        </View>

        <View style={[s.row, { justifyContent: "space-between", marginTop: 28 }]}>
          <View style={{ maxWidth: 260 }}>
            <Text style={s.label}>BILL TO</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{client.name}</Text>
            {client.contact_person ? <Text style={s.muted}>{client.contact_person}</Text> : null}
            <Text style={s.muted}>{[displayPhone(client.whatsapp ?? client.phone), client.email].filter(Boolean).join("  ·  ")}</Text>
            {client.address ? <Text style={s.muted}>{client.address}</Text> : null}
          </View>
          {(inv.project_name || inv.rental_reference) ? (
            <View style={{ alignItems: "flex-end", maxWidth: 220 }}>
              <Text style={s.label}>PROJECT</Text>
              {inv.project_name ? <Text>{inv.project_name}</Text> : null}
              {inv.rental_reference ? <Text style={s.muted}>Rental {inv.rental_reference}</Text> : null}
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 24 }}>
          <View style={[s.row, { borderBottomWidth: 1.5, borderBottomColor: brand }]} fixed>
            <Text style={[s.th, { flex: 1 }]}>DESCRIPTION</Text>
            <Text style={[s.th, { width: 45, textAlign: "right" }]}>QTY</Text>
            <Text style={[s.th, { width: 90, textAlign: "right" }]}>RATE</Text>
            <Text style={[s.th, { width: 95, textAlign: "right" }]}>AMOUNT</Text>
          </View>
          {items.map((i, idx) => (
            <View key={idx} style={[s.row, { borderBottomWidth: 0.5, borderBottomColor: "#e4e6e1" }]} wrap={false}>
              <Text style={[s.td, { flex: 1, paddingRight: 8 }]}>{i.description}</Text>
              <Text style={[s.td, { width: 45, textAlign: "right" }]}>{Number(i.quantity)}</Text>
              <Text style={[s.td, { width: 90, textAlign: "right" }]}>{m(i.unit_price, cur)}</Text>
              <Text style={[s.td, { width: 95, textAlign: "right" }]}>{m(i.amount, cur)}</Text>
            </View>
          ))}
        </View>

        <View style={{ alignItems: "flex-end", marginTop: 14 }} wrap={false}>
          <View style={{ width: 230 }}>
            {[
              ["Subtotal", m(inv.subtotal, cur)],
              ...(Number(inv.discount_amount) > 0 ? [["Discount", `-${m(inv.discount_amount, cur)}`]] : []),
              ...(Number(inv.tax_rate) > 0 ? [[`Tax (${Number(inv.tax_rate)}%)`, m(inv.tax_amount, cur)]] : []),
            ].map(([k, v]) => <View key={k} style={[s.row, { justifyContent: "space-between", paddingVertical: 2 }]}><Text style={s.muted}>{k}</Text><Text>{v}</Text></View>)}
            <View style={[s.row, { justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: brand, marginTop: 4, paddingTop: 5 }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>TOTAL</Text><Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{m(inv.total, cur)}</Text>
            </View>
            <View style={[s.row, { justifyContent: "space-between", paddingVertical: 2, marginTop: 3 }]}><Text style={s.muted}>Paid</Text><Text>{m(inv.amount_paid, cur)}</Text></View>
            <View style={[s.row, { justifyContent: "space-between", paddingVertical: 2 }]}><Text style={{ fontFamily: "Helvetica-Bold" }}>Balance due</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{m(inv.balance, cur)}</Text></View>
          </View>
        </View>

        {payments.length > 0 && (
          <View style={{ marginTop: 18 }} wrap={false}>
            <Text style={s.label}>PAYMENTS RECEIVED</Text>
            {payments.map((p, i) => (
              <Text key={i} style={s.muted}>{new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }).format(new Date(p.paid_at))}  ·  {m(p.amount, cur)}  ·  {p.method.replace(/_/g, " ")}{p.reference ? `  ·  ${p.reference}` : ""}</Text>
            ))}
          </View>
        )}

        <View style={[s.row, { marginTop: 22, gap: 24 }]} wrap={false}>
          {inv.payment_instructions ? <View style={{ flex: 1 }}><Text style={s.label}>PAYMENT INSTRUCTIONS</Text><Text>{inv.payment_instructions}</Text></View> : null}
          {inv.notes ? <View style={{ flex: 1 }}><Text style={s.label}>NOTES</Text><Text>{inv.notes}</Text></View> : null}
        </View>

        <View style={{ position: "absolute", bottom: 28, left: 40, right: 40 }} fixed>
          {company.invoice_footer ? <Text style={[s.muted, { textAlign: "center", fontSize: 8 }]}>{company.invoice_footer}</Text> : null}
          <Text style={[s.muted, { textAlign: "right", fontSize: 7 }]} render={({ pageNumber, totalPages }) => `${inv.number} · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
