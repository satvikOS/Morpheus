# Public C++ metadata plane

This is a real, intentionally small C++20 HTTP process exposing `/health`, `/healthz`, `/version`, and `/metadata`, with the same endpoints under `/api/cloud-cpp/` for Vercel service routing that preserves the rewrite prefix. It hosts no private recordings, acquisition clocks, persistent job queue, or model execution. Its metadata describes the implemented capabilities and bounds. The local native core remains the signal execution plane.

```sh
cmake -S services/morpheus-cloud-cpp -B services/morpheus-cloud-cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build services/morpheus-cloud-cpp/build --parallel 4
PORT=8080 services/morpheus-cloud-cpp/build/morpheus_cloud
python3 scripts/native-cloud-test.py
```

Local binding defaults to `127.0.0.1`; `MORPHEUS_CLOUD_BIND=0.0.0.0` enables container routing. The service accepts one request at a time, with an 8 KiB header limit, two-second request deadline, and backlog of 16. Its strict read-only HTTP subset requires a single nonempty Host, valid header token/value syntax, and unambiguous Content-Length. It rejects Transfer-Encoding, duplicate length fields, numeric length overflow, folded headers, and GET bodies (declared or already present after headers). Host is required for both supported HTTP/1.0 and HTTP/1.1 request lines. Unsupported methods receive 405 after framing validation. Every connection closes; a graceful half-close discards up to 8 KiB of pending request body over at most 50 ms so rejected uploads cannot truncate the response through an unread-body TCP reset. No body is stored, echoed, or forwarded. Put it behind the hosting platform's HTTP routing; this is an engineering foundation, not a general HTTP framework or a high-concurrency service.

The `Dockerfile.vercel` build context is this directory. For a standalone project, configure its root to this directory; the main project can also register a `cloud-cpp` container service rooted here and route `/api/cloud-cpp/(.*)` to it. Set project environment variable `PORT=8080` to match the unprivileged process. Current [Vercel container documentation](https://vercel.com/docs/functions/container-images) supports OCI functions using `Dockerfile.vercel`; [Services](https://vercel.com/docs/services) supports routing a container alongside the frontend. Verified against official documentation on 2026-10-06. Local HTTP compilation/testing does not establish a successful OCI build or account-specific deployment; Docker availability and a Vercel build must be checked separately.
