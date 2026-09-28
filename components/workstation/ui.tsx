"use client";

import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel rounded-2xl ${className}`}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/[.07] px-5 py-4 md:flex-row md:items-center md:justify-between">
      <div>
        {eyebrow ? (
          <div className="mb-1 text-[10px] uppercase tracking-[.22em] text-slate-600">{eyebrow}</div>
        ) : null}
        <h2 className="text-sm font-medium text-slate-100">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.55)]" : "bg-slate-600"}`}
    />
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[.07] bg-black/15 p-4">
      <div className="text-[10px] uppercase tracking-[.18em] text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</div>
      {detail ? <div className="mt-1 text-[11px] text-slate-600">{detail}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-12 text-center text-xs leading-6 text-slate-600">{children}</div>;
}
