export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">RW</div>
          <div className="text-lg font-semibold">RW Production OS</div>
          <div className="text-xs text-muted">Equipment rental operations</div>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
