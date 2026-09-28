"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Morpheus UI boundary]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030609] px-6 text-slate-200">
      <div className="panel w-full max-w-xl rounded-2xl p-6">
        <AlertTriangle size={20} className="text-amber-200/80" />
        <div className="mt-6 text-[10px] uppercase tracking-[.2em] text-slate-600">
          Workstation recovery
        </div>
        <h1 className="mt-2 text-xl font-semibold">A workstation module failed safely.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          The UI boundary isolated the failure instead of allowing one module to take down the entire research surface.
        </p>
        {error.digest ? (
          <div className="mt-4 rounded-lg border border-white/[.06] bg-black/20 p-3 font-mono text-[10px] text-slate-600">
            digest: {error.digest}
          </div>
        ) : null}
        <button className="button-primary mt-5" onClick={reset}>
          <RefreshCw size={13} /> Recover module
        </button>
      </div>
    </main>
  );
}
