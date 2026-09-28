import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030609] px-6 text-slate-200">
      <div className="panel w-full max-w-lg rounded-2xl p-6">
        <div className="text-[10px] uppercase tracking-[.2em] text-slate-600">404 / Morpheus</div>
        <h1 className="mt-2 text-xl font-semibold">Research surface not found.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          The requested route is not part of the current workstation topology.
        </p>
        <Link href="/" className="button-primary mt-5">Return to workstation</Link>
      </div>
    </main>
  );
}
