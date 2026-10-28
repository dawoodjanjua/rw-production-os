"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const permission = /permission/i.test(error.message) && !error.digest;
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-base font-semibold">{permission ? "You don't have access to this" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-muted">
        {permission ? "Your role in this workspace doesn't allow this action. Ask your company owner if you need access." : "The page could not be loaded. Please try again."}
        {error.digest && <span className="mt-2 block text-xs">Reference: {error.digest}</span>}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {!permission && <button onClick={reset} className="btn-secondary">Try again</button>}
        <Link href="/dashboard" className="btn-primary">Go to dashboard</Link>
      </div>
    </div>
  );
}
