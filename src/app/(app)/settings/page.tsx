import { requireTenant } from "@/lib/auth";
import { logoUrl } from "@/lib/branding";
import { Card, Notice } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { removeLogo, saveBillingRules, saveCompany, uploadLogo } from "./actions";

export const metadata = { title: "Settings" };

export default async function CompanySettings() {
  const ctx = await requireTenant();
  const s = ctx.settings;
  const owner = ctx.role === "owner";
  const logo = await logoUrl(ctx.supabase, s.logo_path);
  const tzs = Intl.supportedValuesOf("timeZone");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {!owner && <Notice tone="info">Only the company owner can change these settings.</Notice>}
        <ActionForm action={saveCompany}>
          <fieldset disabled={!owner} className="space-y-6">
            <Card title="Company & branding">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="label">Company name *</span><input name="company_name" required defaultValue={s.company_name} className="input" /></label>
                <label><span className="label">Tagline</span><input name="tagline" defaultValue={s.tagline ?? ""} className="input" placeholder="Production · Creative · Equipment" /></label>
                <label><span className="label">Brand colour</span><div className="flex gap-2"><span className="h-9 w-12 shrink-0 rounded border border-line" style={{ background: s.brand_color }} aria-hidden /><input name="brand_color" defaultValue={s.brand_color} className="input" pattern="#[0-9a-fA-F]{6}" /></div></label>
                <label><span className="label">Phone</span><input name="phone" defaultValue={s.phone ?? ""} className="input" /></label>
                <label><span className="label">WhatsApp</span><input name="whatsapp" defaultValue={s.whatsapp ?? ""} className="input" /></label>
                <label><span className="label">Email</span><input name="email" type="email" defaultValue={s.email ?? ""} className="input" /></label>
                <label><span className="label">Website</span><input name="website" defaultValue={s.website ?? ""} className="input" /></label>
                <label className="sm:col-span-2"><span className="label">Address</span><textarea name="address" rows={2} defaultValue={s.address ?? ""} className="input" /></label>
                <label><span className="label">NTN / tax number</span><input name="ntn" defaultValue={s.ntn ?? ""} className="input" /></label>
              </div>
            </Card>
            <Card title="Regional & numbering">
              <div className="grid gap-4 sm:grid-cols-4">
                <label><span className="label">Currency</span><input name="currency" defaultValue={s.currency} maxLength={3} className="input uppercase" /></label>
                <label className="sm:col-span-3"><span className="label">Timezone</span><select name="timezone" defaultValue={s.timezone} className="input">{tzs.map((z) => <option key={z}>{z}</option>)}</select></label>
                <label><span className="label">Invoice prefix</span><input name="invoice_prefix" defaultValue={s.invoice_prefix} className="input uppercase" /></label>
                <label><span className="label">Rental prefix</span><input name="rental_prefix" defaultValue={s.rental_prefix} className="input uppercase" /></label>
                <label><span className="label">Payment terms (days)</span><input name="payment_terms_days" type="number" min={0} defaultValue={s.payment_terms_days} className="input" /></label>
                <label><span className="label">Default tax rate %</span><input name="tax_rate" inputMode="decimal" defaultValue={s.tax_rate} className="input" /></label>
              </div>
            </Card>
            <Card title="Invoice text">
              <div className="grid gap-4">
                <label><span className="label">Payment instructions</span><textarea name="payment_instructions" rows={3} defaultValue={s.payment_instructions ?? ""} className="input" placeholder="Bank: … · Account title: … · IBAN: …" /></label>
                <label><span className="label">Invoice footer</span><input name="invoice_footer" defaultValue={s.invoice_footer ?? ""} className="input" /></label>
              </div>
            </Card>
            {owner && <SubmitButton>Save company settings</SubmitButton>}
          </fieldset>
        </ActionForm>
      </div>

      <div className="space-y-6">
        <Card title="Logo">
          <div className="mb-4 flex h-24 items-center justify-center rounded-lg border border-dashed border-line bg-bg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt="Company logo" className="max-h-20 max-w-[80%] object-contain" /> : <span className="text-xs text-muted">No logo</span>}
          </div>
          {owner && <>
            <ActionForm action={uploadLogo} className="space-y-2">
              <input type="file" name="logo" accept="image/png,image/jpeg" required className="block w-full text-sm" />
              <p className="text-xs text-muted">PNG or JPG, up to 2 MB. Stored privately; shown on your workspace and invoices.</p>
              <SubmitButton className="btn-secondary" pendingText="Uploading…">Upload logo</SubmitButton>
            </ActionForm>
            {logo && <ActionForm action={removeLogo} className="mt-2"><SubmitButton className="btn-ghost text-xs">Remove logo</SubmitButton></ActionForm>}
          </>}
        </Card>
        <Card title="Late returns">
          <ActionForm action={saveBillingRules}>
            <fieldset disabled={!owner} className="space-y-3">
              <label className="block"><span className="label">Grace period (minutes)</span><input name="grace_minutes" type="number" min={0} defaultValue={s.grace_minutes} className="input" /></label>
              <label className="block"><span className="label">Late fee</span>
                <select name="late_fee_mode" defaultValue={s.late_fee_mode} className="input">
                  <option value="none">No automatic late fee</option>
                  <option value="per_unit_per_hour">Fixed amount per unit per started hour</option>
                  <option value="day_rate_per_day">Item day rate per started late day</option>
                </select></label>
              <label className="block"><span className="label">Amount per unit per hour ({s.currency})</span><input name="late_fee_amount" inputMode="decimal" defaultValue={s.late_fee_amount} className="input" /></label>
              <p className="text-xs text-muted">Late fees are only added when returned after the deadline plus the grace period, counted from the deadline. They are shown as a separate charge on the rental and can be waived by a manager.</p>
              {owner && <SubmitButton className="btn-secondary">Save</SubmitButton>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
