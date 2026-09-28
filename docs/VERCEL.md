# Vercel deployment

This repository should be deployed as a standard **Next.js** application from the repository root.

The local FastAPI signal gateway is intentionally **not** deployed as a Vercel service. It depends on native LSL / BrainFlow access and should run on the acquisition workstation.

## Project settings

- Framework: Next.js
- Root Directory: `./`
- Build Command: `pnpm build`
- Install Command: `pnpm install`
- Output Directory: leave as Next.js default / `.next`

## Environment

Set:

```
NEXT_PUBLIC_MORPHEUS_GATEWAY_URL=http://localhost:8787
```

for local browser development.

For a remotely hosted browser, localhost refers to the user's own machine only when accessed by that browser. A production bridge should use a secure tunnel / local agent architecture rather than exposing acquisition endpoints directly to the public internet.

## Why there is only one Vercel service

Vercel detected `services/signal-gateway` because it contains FastAPI code. Morpheus intentionally does **not** deploy that directory as a cloud service. The gateway must remain close to the hardware for latency, device access, and data privacy.
