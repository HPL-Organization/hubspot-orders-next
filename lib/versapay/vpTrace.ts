// src/lib/vpTrace.ts
export const VP_TRACE = true; // flip off in prod if noisy

let seq = 0;
export function vpNow() {
  return new Date().toISOString().split("T")[1].replace("Z", "");
}

export function vpLog(label: string, payload?: any) {
  if (!VP_TRACE) return;
  const n = ++seq;
  if (payload !== undefined) {
    // groupCollapsed so repeated steps stay compact
    console.groupCollapsed(`[VP][${n}] ${vpNow()} ${label}`);
    console.log(payload);
    console.groupEnd();
  } else {
    console.log(`[VP] ${vpNow()} ${label}`);
  }
}

export function color(s: string, c: string) {
  return [`%c${s}`, `color:${c};font-weight:bold;`];
}

/**
 * Intercepts window.fetch to log VersaPay /api/v2/sessions/* calls.
 * Call `enableVpFetchProbe()` before mounting and `disableVpFetchProbe()` on teardown.
 */
let originalFetch: typeof window.fetch | null = null;
export function enableVpFetchProbe(tag: string) {
  if (!VP_TRACE) return;
  if (originalFetch) return; // already enabled
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const isSession = /ecommerce-api\.versapay\.com\/api\/v2\/sessions\//i.test(
      url
    );
    if (isSession) {
      const start = performance.now();
      vpLog(`${tag} → FETCH ${url}`);
      try {
        const res = await originalFetch!(input, init);
        const ms = Math.round(performance.now() - start);
        vpLog(`${tag} ← ${res.status} ${url} (${ms}ms)`);
        return res;
      } catch (e) {
        const ms = Math.round(performance.now() - start);
        vpLog(`${tag} ← ERROR ${url} (${ms}ms)`, e);
        throw e;
      }
    }
    return originalFetch!(input, init);
  };
}

export function disableVpFetchProbe() {
  if (!originalFetch) return;
  window.fetch = originalFetch;
  originalFetch = null;
}
