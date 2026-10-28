"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { logHandoff } from "@/app/(app)/messages/actions";
import { waLink } from "@/lib/whatsapp";

/**
 * Manual WhatsApp handoff: opens the client's chat with a prepared message. The user must press Send in WhatsApp.
 * We log "WhatsApp opened" only — never "sent" or "delivered".
 */
export function WhatsAppButton({ phone, message, purpose, rentalId, invoiceId, clientId, reminderId, label = "Open WhatsApp", editable = true, className = "btn-secondary" }: {
  phone: string | null; message: string; purpose: string; rentalId?: string; invoiceId?: string; clientId?: string; reminderId?: string; label?: string; editable?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(message);
  const [done, setDone] = useState(false);

  if (!phone) return <span className="text-xs text-muted" title="Add a WhatsApp number to the client or rental">No WhatsApp number</span>;

  const go = () => {
    window.open(waLink(phone, text), "_blank", "noopener,noreferrer");
    setDone(true);
    void logHandoff({ purpose, to_phone: phone, body: text, rental_id: rentalId, invoice_id: invoiceId, client_id: clientId, reminder_id: reminderId });
  };

  if (!editable) return <button type="button" onClick={go} className={className}><MessageCircle size={16} />{label}</button>;

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(false); }} className={className}><MessageCircle size={16} />{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">WhatsApp message</h3>
            <p className="mt-1 text-xs text-muted">To {phone}. Review the message, then open WhatsApp and press <b>Send</b> there. {purpose === "invoice" && "Download the PDF first and attach it in the chat."}</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="input mt-3 font-mono text-xs" />
            {done && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">WhatsApp was opened. This app cannot confirm the message was sent — check the chat.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Close</button>
              <button type="button" onClick={go} className="btn-primary"><MessageCircle size={16} />Open WhatsApp</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
