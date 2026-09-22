export interface ThumbnailSource {
  url: string;
  fallbackUrl?: string;
}

export interface ThumbnailDemand extends ThumbnailSource {
  priority: "visible" | "prefetch" | "retain";
  recover?: boolean;
}

export interface ThumbnailSnapshot {
  status: "idle" | "queued" | "loading" | "waiting" | "ready" | "failed";
  src?: string;
}

interface Resource {
  source: ThumbnailSource;
  snapshot: ThumbnailSnapshot;
  image?: HTMLImageElement;
  fallback: boolean;
  retries: number;
  retryAt?: number;
}

const IDLE: ThumbnailSnapshot = { status: "idle" };
const RETRY_DELAYS = [1000, 2000, 4000, 8000];

export class ThumbnailStore {
  private resources = new Map<string, Resource>();
  private consumers = new Map<object, readonly ThumbnailDemand[]>();
  private listeners = new Map<string, Set<() => void>>();
  private cache = new Map<string, Resource>();
  private inflight = new Set<Resource>();
  private paused = false;
  private scrolling = false;
  private timer?: ReturnType<typeof setTimeout>;
  private reconciling = false;
  private reconcileAgain = false;

  getSnapshot = (url: string): ThumbnailSnapshot => this.resources.get(url)?.snapshot ?? IDLE;

  subscribe = (url: string, listener: () => void): (() => void) => {
    let listeners = this.listeners.get(url);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(url, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(url);
    };
  };

  setDemand(consumer: object, demands: readonly ThumbnailDemand[]): void {
    if (demands.length) this.consumers.set(consumer, demands);
    else this.consumers.delete(consumer);
    this.reconcile();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.reconcile();
  }

  setScrolling(scrolling: boolean): void {
    this.scrolling = scrolling;
    this.reconcile();
  }

  reportError(url: string, snapshot: ThumbnailSnapshot): void {
    const resource = this.resources.get(url);
    if (!resource || resource.snapshot !== snapshot || snapshot.status !== "ready") return;
    this.fail(resource);
    this.reconcile();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const resource of this.resources.values()) this.cancel(resource);
    this.inflight.clear();
    this.resources.clear();
    this.cache.clear();
    this.consumers.clear();
    this.listeners.clear();
    this.paused = false;
    this.scrolling = false;
  }

  private publish(resource: Resource, snapshot: ThumbnailSnapshot): void {
    if (resource.snapshot.status === snapshot.status && resource.snapshot.src === snapshot.src)
      return;
    resource.snapshot = snapshot;
    for (const listener of this.listeners.get(resource.source.url) ?? []) listener();
  }

  private cancel(resource: Resource): void {
    const image = resource.image;
    if (!image) return;
    resource.image = undefined;
    this.inflight.delete(resource);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    this.publish(resource, { status: "queued" });
  }

  private fail(resource: Resource): void {
    this.cache.delete(resource.source.url);
    if (!resource.fallback && resource.source.fallbackUrl) {
      resource.fallback = true;
      this.publish(resource, { status: "queued" });
      return;
    }
    const delay = RETRY_DELAYS[resource.retries];
    resource.retryAt = delay === undefined ? undefined : Date.now() + delay;
    this.publish(resource, { status: delay === undefined ? "failed" : "waiting" });
  }

  private start(resource: Resource): void {
    if (resource.retryAt !== undefined) {
      resource.retryAt = undefined;
      resource.retries += 1;
      resource.fallback = false;
    }
    const source = resource.source;
    const src = resource.fallback
      ? source.fallbackUrl!
      : source.url +
        (resource.retries
          ? `${source.url.includes("?") ? "&" : "?"}retry=${resource.retries}`
          : "");
    const image = new Image();
    resource.image = image;
    this.inflight.add(resource);
    this.publish(resource, { status: "loading" });
    const finish = (success: boolean) => {
      if (resource.image !== image || this.resources.get(source.url) !== resource) return;
      resource.image = undefined;
      this.inflight.delete(resource);
      image.onload = null;
      image.onerror = null;
      if (success) {
        resource.retries = 0;
        resource.fallback = false;
        this.cache.delete(source.url);
        this.cache.set(source.url, resource);
        this.publish(resource, { status: "ready", src });
      } else {
        this.fail(resource);
      }
      this.reconcile();
    };
    image.decoding = "async";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  }

  private reconcile(): void {
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.reconcileAgain = false;
        this.update();
      } while (this.reconcileAgain);
    } finally {
      this.reconciling = false;
    }
  }

  private update(): void {
    clearTimeout(this.timer);
    const demands = new Map<string, ThumbnailDemand>();
    const rank = { visible: 0, prefetch: 1, retain: 2 };
    for (const values of this.consumers.values()) {
      for (const demand of values) {
        const previous = demands.get(demand.url);
        demands.set(demand.url, {
          ...demand,
          priority:
            previous && rank[previous.priority] < rank[demand.priority]
              ? previous.priority
              : demand.priority,
          recover: Boolean(previous?.recover || demand.recover),
        });
      }
    }
    for (const [url, demand] of demands) {
      if (!this.resources.has(url)) {
        this.resources.set(url, { source: demand, snapshot: IDLE, fallback: false, retries: 0 });
      }
      if (this.cache.has(url)) {
        const resource = this.resources.get(url)!;
        this.cache.delete(url);
        this.cache.set(url, resource);
      }
    }
    for (const [url, resource] of this.resources) {
      if (demands.has(url)) continue;
      this.cancel(resource);
      if (resource.snapshot.status !== "ready") this.resources.delete(url);
    }
    const unused = [...this.cache.keys()].filter((url) => !demands.has(url));
    for (const url of unused.slice(0, Math.max(0, this.cache.size - 500))) {
      this.cache.delete(url);
      this.resources.delete(url);
    }
    if (this.paused) return;

    const eligible = (demand: ThumbnailDemand) =>
      demand.priority !== "retain" && (!this.scrolling || demand.priority === "visible");
    for (const [url, resource] of this.resources) {
      const demand = demands.get(url);
      if (
        resource.image &&
        demand &&
        (!eligible(demand) || (resource.fallback && !demand.recover))
      ) {
        this.cancel(resource);
      }
    }
    const candidates = [...demands.values()]
      .filter(eligible)
      .sort((a, b) => rank[a.priority] - rank[b.priority]);
    const limit = this.scrolling ? 8 : 24;
    let wakeAt = Infinity;
    for (const demand of candidates) {
      const resource = this.resources.get(demand.url)!;
      if (
        resource.image ||
        resource.snapshot.status === "ready" ||
        resource.snapshot.status === "failed"
      )
        continue;
      if ((resource.fallback || resource.retryAt !== undefined) && !demand.recover) continue;
      if (resource.retryAt !== undefined && resource.retryAt > Date.now()) {
        wakeAt = Math.min(wakeAt, resource.retryAt);
        continue;
      }
      if (this.inflight.size >= limit && demand.priority === "visible") {
        for (const entry of this.inflight) {
          if (demands.get(entry.source.url)?.priority !== "prefetch") continue;
          this.cancel(entry);
          break;
        }
      }
      if (this.inflight.size < limit) this.start(resource);
      else this.publish(resource, { status: "queued" });
    }
    if (Number.isFinite(wakeAt))
      this.timer = setTimeout(() => this.reconcile(), Math.max(0, wakeAt - Date.now()));
  }
}
