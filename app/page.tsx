"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BrainCircuit, Database, FlaskConical, Gauge, Radio,
  ScanLine, ShieldCheck, Waves, Boxes, Network, Cpu, Clock3
} from "lucide-react";

const Scene3D = dynamic(() => import("./visual-lab"), { ssr: false });

type GatewayStatus={status:"online"|"offline";streams:number;timestamp:string};
type Stream={name:string;type:string;channel_count:number;nominal_srate:number;source_id:string};
type SamplePacket={stream:string;ts:number;channels:number[]};

const cards=[
  ["Acquisition","Native LSL / BrainFlow streams",Radio],
  ["Dataset Zero","Immutable dream + event records",Database],
  ["Neural Atlas","Representation learning workspace",BrainCircuit],
  ["Protocols","Timestamped experiment control",FlaskConical]
] as const;

function Sparkline({values}:{values:number[]}) {
  const points=values.length?values:Array.from({length:64},(_,i)=>Math.sin(i/5)*0.35+Math.sin(i/2.8)*0.12);
  const path=points.map((v,i)=>`${(i/(points.length-1))*100},${50-v*34}`).join(" ");
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
    <polyline fill="none" stroke="currentColor" strokeWidth="1.3" points={path}/>
  </svg>;
}

export default function Home(){
  const gateway=process.env.NEXT_PUBLIC_MORPHEUS_GATEWAY_URL??"http://localhost:8787";
  const [status,setStatus]=useState<GatewayStatus>({status:"offline",streams:0,timestamp:""});
  const [streams,setStreams]=useState<Stream[]>([]);
  const [samples,setSamples]=useState<number[]>([]);
  const [latency,setLatency]=useState<number|null>(null);
  const [activeTab,setActiveTab]=useState<"monitor"|"visual">("monitor");
  const lastTs=useRef<number|null>(null);

  useEffect(()=>{
    let active=true;
    const poll=async()=>{
      const t0=performance.now();
      try{
        const [health,streamData]=await Promise.all([
          fetch(`${gateway}/health`,{cache:"no-store"}).then(r=>r.json()),
          fetch(`${gateway}/streams`,{cache:"no-store"}).then(r=>r.json())
        ]);
        if(active){
          setStatus(health);
          setStreams(streamData.streams??[]);
          setLatency(Math.round(performance.now()-t0));
        }
      }catch{
        if(active){
          setStatus({status:"offline",streams:0,timestamp:new Date().toISOString()});
          setStreams([]);
          setLatency(null);
        }
      }
    };
    poll();
    const timer=setInterval(poll,2200);
    return()=>{active=false;clearInterval(timer)};
  },[gateway]);

  useEffect(()=>{
    const wsBase=gateway.replace(/^http/,"ws");
    let ws:WebSocket|undefined;
    let reconnect:number|undefined;
    const connect=()=>{
      try{
        ws=new WebSocket(`${wsBase}/ws/samples`);
        ws.onmessage=(event)=>{
          const packet=JSON.parse(event.data) as SamplePacket;
          if(packet.channels?.length){
            setSamples(prev=>[...prev,packet.channels[0]].slice(-160));
            lastTs.current=packet.ts;
          }
        };
        ws.onclose=()=>{ reconnect=window.setTimeout(connect,1500); };
        ws.onerror=()=>ws?.close();
      }catch{}
    };
    connect();
    return()=>{ if(reconnect)clearTimeout(reconnect); ws?.close(); };
  },[gateway]);

  const streamChannels=useMemo(()=>streams.reduce((n,s)=>n+(s.channel_count||0),0),[streams]);

  return <main className="min-h-screen px-4 py-4 lg:px-6">
    <div className="mx-auto max-w-[1800px]">
      <header className="panel mb-4 flex flex-col gap-4 rounded-2xl px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[.26em] text-slate-500"><Waves size={13}/> Morpheus Workstation</div>
          <div className="mt-1 flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Neural Systems Console</h1>
            <span className="rounded-md border border-white/10 bg-white/[.03] px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">v0.1</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"><span className="text-slate-500">Gateway </span><span className={status.status==="online"?"text-emerald-300":"text-slate-400"}>{status.status}</span></div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"><span className="text-slate-500">RTT </span>{latency===null?"—":`${latency} ms`}</div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"><span className="text-slate-500">Channels </span>{streamChannels}</div>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <aside className="panel rounded-2xl p-3">
          <div className="space-y-2">
            {cards.map(([title,body,Icon])=><div key={title} className="rounded-xl border border-white/[.07] bg-white/[.02] p-3">
              <div className="flex items-center gap-2"><Icon size={16} className="text-slate-300"/><span className="text-sm font-medium">{title}</span></div>
              <div className="mt-2 text-xs leading-5 text-slate-500">{body}</div>
            </div>)}
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-2 text-[10px] uppercase tracking-[.22em] text-slate-600">Subsystems</div>
            {[
              [Cpu,"Signal Engine"],[Network,"Stream Graph"],[Boxes,"3D Visual Lab"],[ShieldCheck,"Data Integrity"]
            ].map(([Icon,label])=><div key={String(label)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-400"><Icon size={14}/>{String(label)}</div>)}
          </div>
        </aside>

        <div className="space-y-4">
          <div className="panel rounded-2xl p-2">
            <div className="flex gap-2">
              <button onClick={()=>setActiveTab("monitor")} className={`rounded-lg px-3 py-2 text-xs ${activeTab==="monitor"?"bg-white/[.08] text-white":"text-slate-500"}`}>Signal Monitor</button>
              <button onClick={()=>setActiveTab("visual")} className={`rounded-lg px-3 py-2 text-xs ${activeTab==="visual"?"bg-white/[.08] text-white":"text-slate-500"}`}>3D Visual Lab</button>
            </div>
          </div>

          {activeTab==="monitor"?<>
            <section className="grid gap-4 xl:grid-cols-[1.5fr_.5fr]">
              <div className="panel rounded-2xl p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div><h2 className="text-sm font-medium">Live waveform</h2><p className="mt-1 text-xs text-slate-600">First channel preview from WebSocket relay</p></div>
                  <ScanLine size={18} className="text-slate-600"/>
                </div>
                <div className="grid-bg h-[330px] overflow-hidden rounded-xl border border-white/[.06] p-3 text-sky-300">
                  <Sparkline values={samples}/>
                </div>
              </div>

              <div className="grid gap-4">
                {[
                  [Gauge,"Streams",status.streams],
                  [Activity,"Samples",samples.length],
                  [Clock3,"Last packet",lastTs.current?new Date(lastTs.current*1000).toLocaleTimeString():"—"]
                ].map(([Icon,label,value])=><div key={String(label)} className="panel rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Icon size={14}/>{String(label)}</div>
                  <div className="mt-4 text-2xl font-semibold">{String(value)}</div>
                </div>)}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
              <div className="panel rounded-2xl p-4">
                <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-medium">Discovered streams</h2><p className="mt-1 text-xs text-slate-600">Native acquisition stays local.</p></div><Activity size={18} className="text-slate-600"/></div>
                <div className="overflow-hidden rounded-xl border border-white/[.06]">
                  <div className="grid grid-cols-[1.2fr_.7fr_.5fr_.6fr] bg-white/[.03] px-4 py-3 text-[10px] uppercase tracking-widest text-slate-600"><span>Stream</span><span>Type</span><span>Ch</span><span>Rate</span></div>
                  {streams.length?streams.map(s=><div key={s.source_id||s.name} className="grid grid-cols-[1.2fr_.7fr_.5fr_.6fr] border-t border-white/[.06] px-4 py-3 text-xs"><span>{s.name}</span><span className="text-slate-500">{s.type}</span><span className="text-slate-500">{s.channel_count}</span><span className="text-slate-500">{s.nominal_srate||"irregular"} Hz</span></div>):<div className="border-t border-white/[.06] px-4 py-10 text-center text-xs text-slate-600">No LSL streams detected.</div>}
                </div>
              </div>

              <div className="panel rounded-2xl p-4">
                <h2 className="text-sm font-medium">M0 / Dataset Zero</h2>
                <p className="mt-2 text-xs leading-5 text-slate-600">Ground truth and provenance layer for dream records and synchronized experiment events.</p>
                <div className="mt-5 space-y-3">
                  {["Capture","SHA-256 seal","Annotate","Link recurrence","Sync physiology"].map((x,i)=><div key={x} className="flex items-center gap-3 text-xs"><span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-slate-600">{i+1}</span><span>{x}</span></div>)}
                </div>
              </div>
            </section>
          </>:<section className="panel overflow-hidden rounded-2xl">
            <div className="border-b border-white/[.07] px-4 py-3">
              <h2 className="text-sm font-medium">3D Visual Lab</h2>
              <p className="mt-1 text-xs text-slate-600">Workspace for spatial reconstructions, latent geometry, volumetric data, and future dream-scene rendering.</p>
            </div>
            <div className="h-[720px]"><Scene3D/></div>
          </section>}
        </div>
      </section>
    </div>
  </main>;
}
