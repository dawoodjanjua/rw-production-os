import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-base font-semibold">You don&apos;t have access to this</h1>
      <p className="mt-2 text-sm text-muted">Your role in this workspace doesn&apos;t allow this page. Ask your company owner if you need access.</p>
      <Link href="/dashboard" className="btn-primary mt-4">Go to dashboard</Link>
    </div>
  );
}
