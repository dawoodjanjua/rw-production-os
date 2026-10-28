"use client";

import { useActionState, useState } from "react";
import type { InviteState } from "../actions";

export function LinkForm({ action, children, className = "" }: { action: (s: InviteState, fd: FormData) => Promise<InviteState>; children: React.ReactNode; className?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state?.error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state?.ok && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {state.ok}
          {state.link && (
            <div className="mt-2 flex gap-2">
              <input readOnly value={state.link} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn-secondary" onClick={() => { navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
