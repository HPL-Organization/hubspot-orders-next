// src/hooks/useVersapaySession.ts
import * as React from "react";
import { vpLog } from "../../lib/versapay/vpTrace";

const TTL_MS_DEFAULT = 7 * 60 * 1000; // 7 minutes

const state = {
  id: null as string | null,
  expiresAt: 0,
  inFlight: null as Promise<string> | null,
  version: 0,
};

const NOT_FOUND_PATTERNS = [
  /session.*not.*found/i,
  /invalid.*session/i,
  /cannot\s*find\s*session/i,
  /no\s*session\s*id/i,
  /\b404\b/,
];

function looksLikeSessionNotFound(err: any): boolean {
  const msg =
    (err?.response?.data && JSON.stringify(err.response.data)) ||
    err?.message ||
    err?.error ||
    err?.details ||
    String(err || "");
  return NOT_FOUND_PATTERNS.some((r) => r.test(msg));
}

async function createNewSession(): Promise<string> {
  const res = await fetch("/api/versapay/create-session", { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.sessionId) {
    throw new Error(json?.error || "Failed to create VersaPay session");
  }
  vpLog(`HOOK created session ${json.sessionId}`);
  return String(json.sessionId);
}

export function useVersapaySession() {
  const ensure = React.useCallback(
    async (opts?: { forceNew?: boolean; ttlMs?: number }) => {
      const ttl = opts?.ttlMs ?? TTL_MS_DEFAULT;
      const now = Date.now();

      if (opts?.forceNew) {
        state.version++;
        state.id = null;
        state.expiresAt = 0;
        state.inFlight = null;
        vpLog("HOOK forceNew");
      }

      if (state.id && now < state.expiresAt && !opts?.forceNew) {
        vpLog(`HOOK reuse session ${state.id}`);
        return state.id;
      }

      if (state.inFlight) return state.inFlight;

      const myVersion = ++state.version;

      state.inFlight = (async () => {
        const sid = await createNewSession();
        if (myVersion !== state.version)
          throw new Error("Superseded session creation");
        state.id = sid;
        state.expiresAt = Date.now() + ttl;
        vpLog(`HOOK set session=${sid} ttlMs=${ttl}`);
        return sid;
      })();

      try {
        return await state.inFlight;
      } finally {
        state.inFlight = null;
      }
    },
    []
  );

  const reset = React.useCallback(() => {
    state.version++;
    state.id = null;
    state.expiresAt = 0;
    state.inFlight = null;
  }, []);

  const withSession = React.useCallback(
    async <T>(
      op: (sessionId: string) => Promise<T>,
      opts?: { forceNew?: boolean; ttlMs?: number }
    ) => {
      const sid = await ensure(opts);
      try {
        return await op(sid);
      } catch (e) {
        if (looksLikeSessionNotFound(e)) {
          vpLog(`HOOK sessionNotFound for ${sid}, retrying once`);
          reset();
          const sid2 = await ensure({ forceNew: true, ttlMs: opts?.ttlMs });
          vpLog(`HOOK retry with ${sid2}`);
          return await op(sid2);
        }
        throw e;
      }
    },
    [ensure, reset]
  );

  return { ensure, reset, withSession };
}
