"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkstationView } from "@/lib/morpheus";
type Item = { id: WorkstationView; label: string; hint: string };
export default function CommandPalette({ items, onNavigate }: { items: Item[]; onNavigate: (view: WorkstationView) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  function show() { setQuery(""); dialog.current?.showModal(); input.current?.focus(); }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close(); else show();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  return <>
    <button className="command-launch button-secondary" onClick={show} aria-haspopup="dialog">Find workspace <kbd>⌘ K</kbd></button>
    <dialog ref={dialog} className="command-dialog" aria-labelledby="command-title">
      <div className="command-heading"><h2 id="command-title">Go to workspace</h2><button className="button-secondary" onClick={() => dialog.current?.close()}>Close</button></div>
      <label className="command-search">Search workspaces<input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dream reports, model runs, literature…" /></label>
      <div className="command-results">{items.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button key={item.id} onClick={() => { onNavigate(item.id); dialog.current?.close(); }}><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div>
    </dialog>
  </>;
}
