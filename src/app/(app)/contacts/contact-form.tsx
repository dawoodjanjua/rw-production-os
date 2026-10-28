import { ActionForm, SubmitButton } from "@/components/forms";
import { saveContact } from "./actions";

type Contact = { id?: string; name?: string; contact_person?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; address?: string | null; notes?: string | null };

export function ContactForm({ kind, contact, returnTo }: { kind: "client" | "supplier"; contact?: Contact; returnTo?: string }) {
  return (
    <ActionForm action={saveContact} className="card grid gap-4 p-4 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} />
      {contact?.id && <input type="hidden" name="id" value={contact.id} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <label className="sm:col-span-2"><span className="label">{kind === "client" ? "Client / company name *" : "Supplier name *"}</span><input name="name" required defaultValue={contact?.name ?? ""} className="input" /></label>
      <label><span className="label">Contact person</span><input name="contact_person" defaultValue={contact?.contact_person ?? ""} className="input" /></label>
      <label><span className="label">Email</span><input name="email" type="email" defaultValue={contact?.email ?? ""} className="input" /></label>
      <label><span className="label">Phone</span><input name="phone" defaultValue={contact?.phone ?? ""} className="input" placeholder="0300 1234567" /></label>
      <label><span className="label">WhatsApp number</span><input name="whatsapp" defaultValue={contact?.whatsapp ?? ""} className="input" placeholder="Same as phone if empty" />
        <span className="mt-1 block text-xs text-muted">Pakistani numbers like 0300… are converted to +92 format.</span></label>
      <label className="sm:col-span-2"><span className="label">Address</span><textarea name="address" rows={2} defaultValue={contact?.address ?? ""} className="input" /></label>
      <label className="sm:col-span-2"><span className="label">Notes</span><textarea name="notes" rows={2} defaultValue={contact?.notes ?? ""} className="input" /></label>
      <div className="sm:col-span-2"><SubmitButton>{contact?.id ? "Save changes" : `Add ${kind}`}</SubmitButton></div>
    </ActionForm>
  );
}
