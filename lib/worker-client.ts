export type SignalAnalysis = {
  mean: number;
  rms: number;
  peak: number;
  zeroCrossings: number;
  bands: Record<string, number>;
};

type Pending = {
  resolve: (value: { metrics: SignalAnalysis; latencyMs: number }) => void;
  reject: (reason?: unknown) => void;
};

export class SignalWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();

  start() {
    if (typeof window === "undefined" || this.worker) return;
    this.worker = new Worker("/workers/signal-worker.js");
    this.worker.onmessage = (event) => {
      const message = event.data || {};
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) {
        request.resolve({ metrics: message.metrics, latencyMs: message.latencyMs });
      } else {
        request.reject(new Error(message.error || "Worker failed"));
      }
    };
  }

  analyze(samples: number[], sampleRate = 256) {
    this.start();
    if (!this.worker) return Promise.reject(new Error("Web Worker unavailable"));

    const id = crypto.randomUUID();
    return new Promise<{ metrics: SignalAnalysis; latencyMs: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ id, type: "analyze", samples, sampleRate });
      window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("Worker analysis timeout"));
      }, 4000);
    });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.pending.values()) request.reject(new Error("Worker stopped"));
    this.pending.clear();
  }
}
