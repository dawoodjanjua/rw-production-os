"use client";

import { useActionState, useState } from "react";
import type { AdminState } from "./actions";

export function AdminForm({ action, children, className = "", submit }: { action: (s: AdminState, fd: FormData) => Promise<AdminState>; children: React.ReactNode; className?: string; submit: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} className={className}>
      {children}
      <button disabled={pending} className="btn-primary mt-3">{pending ? "Working…" : submit}</button>
      {state?.error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state?.ok && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{state.ok}
        {state.link && <div className="mt-2 flex gap-2"><input readOnly value={state.link} className="input font-mono text-xs" /><button type="button" className="btn-secondary" onClick={() => { navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button></div>}
      </div>}
    </form>
  );
}
