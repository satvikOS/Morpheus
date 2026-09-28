"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Suspense } from "react";

function NeuralField(){
  const points=Array.from({length:180},(_,i)=>{
    const a=i*0.61803398875*Math.PI*2;
    const r=1.1+((i%19)/19)*2.6;
    const y=((i%31)-15)/10;
    return [Math.cos(a)*r,y,Math.sin(a)*r] as [number,number,number];
  });

  return <>
    {points.map((p,i)=><mesh key={i} position={p}>
      <sphereGeometry args={[i%11===0?.06:.025,12,12]}/>
      <meshStandardMaterial emissive={i%11===0?"#7dd3fc":"#334155"} color={i%11===0?"#bae6fd":"#475569"} emissiveIntensity={i%11===0?1.5:.15}/>
    </mesh>)}
  </>;
}

export default function VisualLab(){
  return <div className="h-full w-full bg-[#05080d]">
    <Canvas dpr={[1,1.7]} gl={{antialias:true,powerPreference:"high-performance"}}>
      <PerspectiveCamera makeDefault position={[6,4.5,7]} fov={46}/>
      <ambientLight intensity={0.35}/>
      <directionalLight position={[5,8,4]} intensity={1.1}/>
      <Suspense fallback={null}>
        <NeuralField/>
        <Grid args={[40,40]} cellSize={.5} cellThickness={.5} cellColor="#1f2937" sectionSize={5} sectionThickness={1} sectionColor="#334155" fadeDistance={30} fadeStrength={1}/>
      </Suspense>
      <OrbitControls enableDamping dampingFactor={.08}/>
    </Canvas>
  </div>;
}
