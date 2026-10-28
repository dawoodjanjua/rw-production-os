import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { loadInvoice } from "@/lib/invoice-data";
import { InvoicePdf } from "@/lib/pdf/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generates the invoice PDF on demand. The invoice is loaded with the user's RLS-scoped client,
 *  so guessing another tenant's invoice id returns 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const ctx = await getTenantContext();
  if (!ctx) return new NextResponse("Not found", { status: 404 });
  const data = await loadInvoice(ctx, id);
  if (!data) return new NextResponse("Not found", { status: 404 });

  let logo: { data: Buffer; format: "png" | "jpg" } | null = null;
  const path = data.company.logo_path;
  if (path && /\.(png|jpe?g)$/i.test(path)) {
    const { data: blob } = await ctx.supabase.storage.from("tenant-files").download(path);
    if (blob) logo = { data: Buffer.from(await blob.arrayBuffer()), format: /\.png$/i.test(path) ? "png" : "jpg" };
  }

  const buffer = await renderToBuffer(
    <InvoicePdf inv={data.inv} items={data.items} payments={data.payments} client={data.client} company={data.company} brand={data.brand} logo={logo} tz={ctx.settings.timezone} />,
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
