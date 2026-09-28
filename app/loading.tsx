export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030609]">
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300/70" />
        Initializing Morpheus workstation…
      </div>
    </main>
  );
}
