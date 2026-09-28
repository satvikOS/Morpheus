"use client";

import { useEffect, useState } from "react";
import { Activity, BrainCircuit, Database, Radio, ShieldCheck, Waves } from "lucide-react";

type GatewayStatus={status:"online"|"offline";streams:number;timestamp:string};
type Stream={name:string;type:string;channel_count:number;nominal_srate:number;source_id:string};

const cards=[
  ["Dataset Zero","Immutable dream records, event structure, and provenance.",Database],
  ["Live acquisition","LSL-discovered neural and physiological streams.",Radio],
  ["Neural atlas","Subject-specific representation learning and decoding.",BrainCircuit],
  ["Experiment control","Timestamped markers and reproducible protocols.",ShieldCheck]
] as const;

export default function Home(){
  const gateway=process.env.NEXT_PUBLIC_MORPHEUS_GATEWAY_URL??"http://localhost:8787";
  const [status,setStatus]=useState<GatewayStatus>({status:"offline",streams:0,timestamp:""});
  const [streams,setStreams]=useState<Stream[]>([]);

  useEffect(()=>{
    let active=true;
    const poll=async()=>{
      try{
        const [health,streamData]=await Promise.all([
          fetch(`${gateway}/health`).then(r=>r.json()),
          fetch(`${gateway}/streams`).then(r=>r.json())
        ]);
        if(active){setStatus(health);setStreams(streamData.streams??[])}
      }catch{
        if(active){setStatus({status:"offline",streams:0,timestamp:new Date().toISOString()});setStreams([])}
      }
    };
    poll();
    const timer=setInterval(poll,2500);
    return()=>{active=false;clearInterval(timer)};
  },[gateway]);

  return <main className="min-h-screen px-6 py-7 lg:px-10">
    <div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col gap-6 border-b border-white/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-slate-400"><Waves size={14}/> Project Morpheus / Research Console</div>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight md:text-6xl">Neural experience research, instrumented from first principles.</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-400 md:text-lg">Capture, synchronize, annotate, and interrogate dream and neurophysiological data without pretending the unknowns are solved.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${status.status==="online"?"bg-emerald-300":"bg-slate-600"}`}/><span className="font-medium">{status.status==="online"?`${status.streams} live stream${status.streams===1?"":"s"}`:"gateway offline"}</span></div>
          <div className="mt-1 text-xs text-slate-500">Local signal gateway · LSL discovery</div>
        </div>
      </header>

      <section className="grid gap-4 py-7 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title,body,Icon])=><article key={title} className="min-h-44 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <Icon className="mb-8 text-slate-300" size={22}/><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
        </article>)}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_.6fr]">
        <div className="rounded-2xl border border-white/10 bg-[#0b0e13]/90 p-5">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-medium">Discovered streams</h2><p className="mt-1 text-xs text-slate-500">Native acquisition stays local; the browser is the workstation surface.</p></div><Activity size={19} className="text-slate-500"/></div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-[1.2fr_.7fr_.5fr_.6fr] bg-white/[0.035] px-4 py-3 text-[11px] uppercase tracking-widest text-slate-500"><span>Stream</span><span>Type</span><span>Channels</span><span>Rate</span></div>
            {streams.length?streams.map(stream=><div key={stream.source_id||stream.name} className="grid grid-cols-[1.2fr_.7fr_.5fr_.6fr] border-t border-white/10 px-4 py-4 text-sm"><span>{stream.name}</span><span className="text-slate-400">{stream.type}</span><span className="text-slate-400">{stream.channel_count}</span><span className="text-slate-400">{stream.nominal_srate||"irregular"} Hz</span></div>):<div className="border-t border-white/10 px-4 py-12 text-center"><p className="text-sm text-slate-400">No streams discovered.</p><p className="mt-2 text-xs text-slate-600">Start the local signal gateway and any LSL-compatible source.</p></div>}
          </div>
        </div>
        <aside className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 className="font-medium">M0 / Dataset Zero</h2><p className="mt-2 text-sm leading-6 text-slate-500">First target: establish immutable ground truth before attempting neural reconstruction.</p>
          <ol className="mt-6 space-y-4 text-sm">{["Capture raw report","Hash original record","Annotate separately","Link recurrence graph","Synchronize physiology"].map((item,index)=><li className="flex items-center gap-3" key={item}><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-xs text-slate-500">{index+1}</span><span>{item}</span></li>)}</ol>
        </aside>
      </section>
    </div>
  </main>
}
