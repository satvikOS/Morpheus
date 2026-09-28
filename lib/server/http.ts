export async function fetchJson<T>(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Morpheus-Research-Workstation/0.3",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

export function apiError(source: string, error: unknown, status = 502) {
  return Response.json(
    {
      source,
      ok: false,
      error: error instanceof Error ? error.message : "Upstream request failed",
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
