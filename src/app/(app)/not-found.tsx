import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">This record doesn&apos;t exist in your workspace.</p>
      <Link href="/dashboard" className="btn-primary mt-4">Go to dashboard</Link>
    </div>
  );
}
