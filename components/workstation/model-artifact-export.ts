const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

function assertLoopbackEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Model artifact export requires a valid local gateway URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Model artifact export is restricted to a loopback gateway without credentials.");
  }
  return url;
}

async function readBoundedText(response: Response, maximum = MAX_ARTIFACT_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("The model artifact exceeds the local export size limit.");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximum) throw new Error("The model artifact exceeds the local export size limit.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return text;
      }
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new Error("The model artifact exceeds the local export size limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function downloadModelArtifact(
  endpoint: string,
  identifier: string,
  kind: "export" | "checkpoint",
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  const base = assertLoopbackEndpoint(endpoint);
  if (!/^[0-9a-f-]{36}$/.test(identifier)) throw new Error("The model run identifier is invalid.");
  if (!/^[A-Za-z0-9._-]+\.json$/.test(filename)) throw new Error("The model export filename is invalid.");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/runs/${encodeURIComponent(identifier)}/${kind}`;
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(base, { cache: "no-store", credentials: "omit", signal: requestSignal });
  const body = await readBoundedText(response);
  if (!response.ok) {
    let detail = `Local service returned ${response.status}.`;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.length <= 512) detail = parsed.detail;
    } catch {
      if (body.trim().length > 0 && body.trim().length <= 512) detail = body.trim();
    }
    throw new Error(detail);
  }
  const blob = new Blob([body], { type: "application/json" });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
