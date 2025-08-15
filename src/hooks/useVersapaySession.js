import { useRef, useCallback } from "react";
import {
  getVersapaySessionId,
  resetVersapaySession,
} from "../../lib/versapay/session";

export function useVersapaySession() {
  const lastIdRef = useRef(null);

  const ensure = useCallback(async (opts) => {
    const id = await getVersapaySessionId(opts);
    lastIdRef.current = id;
    return id;
  }, []);

  const reset = useCallback(() => {
    resetVersapaySession();
    lastIdRef.current = null;
  }, []);

  return { ensure, reset, lastIdRef };
}
