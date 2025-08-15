let _state = { id: null, exp: 0, inflight: null };

const DEFAULT_TTL_MS = 12 * 60 * 1000 - 5000;

export async function getVersapaySessionId({ forceNew = false } = {}) {
  const now = Date.now();

  if (!forceNew && _state.id && now < _state.exp) return _state.id;

  if (_state.inflight) return _state.inflight;

  _state.inflight = (async () => {
    const resp = await fetch("/api/versapay/create-session", {
      method: "POST",
    });
    const json = await resp.json();
    if (!resp.ok || !json?.sessionId) {
      throw new Error(json?.message || "Failed to create Versapay session");
    }

    const ttlMs = json.ttlSeconds ? json.ttlSeconds * 1000 : DEFAULT_TTL_MS;

    _state.id = json.sessionId;
    _state.exp = Date.now() + ttlMs;
    return _state.id;
  })();

  try {
    return await _state.inflight;
  } finally {
    _state.inflight = null;
  }
}

export function resetVersapaySession() {
  _state = { id: null, exp: 0, inflight: null };
}

export function looksLikeNotFound(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes("404") ||
    msg.toLowerCase().includes("not found") ||
    err?.response?.status === 404
  );
}
