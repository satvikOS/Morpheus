# Vercel and local execution

The root `vercel.json` defines three services on Node 24:

| Service | Runtime | Responsibility |
| --- | --- | --- |
| frontend | Next.js | Workstation, static recipes, public metadata routes |
| signal-gateway | FastAPI | Hosted capability/health surface; hardware adapters and private jobs stay local |
| cloud-cpp | Container, `Dockerfile.vercel` | Bounded read-only health/version/metadata HTTP process |

Routing dispatches `/api/cloud-cpp/*` and `/api/signal-gateway/*` before the frontend catch-all. The C++ process understands its service prefix. Container deployment requires Vercel container support; local executable verification alone does not establish that the remote image deployed.

Use `npm ci`, `npm run typecheck`, `npm run test:worker`, and `npm run build`. `package-lock.json` pins the resolved graph. Python CI uses 3.12. Production headers retain cross-origin isolation for display buffers and hardware API permissions.

For private analysis, run the local gateway bound to `127.0.0.1`, explicitly set `MORPHEUS_MODEL_RUN_DIR` to a private directory, and select that gateway in Acquisition. Persistent jobs refuse execution when `VERCEL=1`. CORS permits the known production origin and HTTP loopback origins; a preview needs an explicit `MORPHEUS_ALLOWED_ORIGINS` entry. Access from public HTTPS to local HTTP is browser-policy-dependent and must be checked on the actual browser. Do not expose the acquisition service publicly as a workaround.

Deploy a preview through `satvikos-projects/morpheus`, verify service routing and the complete UI, then promote a verified build. Outcomes and limitations are recorded in `docs/EXECUTION_REPORT.md`.

## 2026-10-06 preview receipt

Preview deployment `dpl_CDkr7WpDLnc9VaxAXQtQJs248iUv` is **Ready** at [morpheus-hkou9sxk3-satvikos-projects.vercel.app](https://morpheus-hkou9sxk3-satvikos-projects.vercel.app). Authenticated Vercel CLI requests returned frontend health `status:online`, signal-gateway health `status:online`, and cloud C++ health `status:ok` with `plane:public-metadata`. The public model manifest returned graph version `1.1.0` and contribution content SHA-256 `b13406bc292118c2a98c3312107eb3f2a6128a2bcb93667903ca5141ea3fa924`. The deployment file-tree audit found no private/raw/recording files, `.env` files, DREAM run artifacts or `tmp` files; `.local` and `tmp` directory entries were empty. The preview remained Vercel-auth protected for unauthenticated HTTP clients, as expected for this project.

Production promotion `dpl_FQppbyggPUrGzkXRZB5NbJnKCACP` is **Ready** and aliases [morpheus-three.vercel.app](https://morpheus-three.vercel.app). Authenticated checks returned the same frontend, signal-gateway and cloud C++ health responses, and the production model manifest reported graph version `1.1.0` with the same contribution SHA-256. The production file-tree audit found no private/raw/recording files, `.env` files, DREAM run artifacts or `tmp` files.
