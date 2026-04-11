import { useCallback, useEffect, useState } from "react";
import { fetchAuthStatus, loginWorkshop } from "./api";
import { getWorkshopToken, setWorkshopToken } from "./workshopAuth";

export type WorkshopGateState = "loading" | "login" | "ok";

/**
 * Workshop-Auth-Gate – optimiert für Tablet / PWA:
 *
 * 1. Wenn ein Token gespeichert ist → sofort "ok" (kein Netzwerk-Wait)
 * 2. Token-Validierung läuft im Hintergrund; bei 401 → "login"
 * 3. Ohne Token: kurzer Check ob Auth überhaupt nötig (auth/status)
 * 4. Offline: gespeicherter Token reicht → kein Login-Loop
 */
export function useWorkshopGate() {
  const hasToken = !!getWorkshopToken();
  const [gate, setGate] = useState<WorkshopGateState>(hasToken ? "ok" : "loading");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const s = await fetchAuthStatus();
      if (!s.workshopAuthRequired) {
        setGate("ok");
        return;
      }
      if (getWorkshopToken()) {
        setGate("ok");
        return;
      }
      setGate("login");
    } catch {
      if (getWorkshopToken()) {
        setGate("ok");
      } else {
        setGate("login");
      }
    }
  }, []);

  useEffect(() => {
    if (hasToken) {
      void checkSession();
    } else {
      void checkSession();
    }
  }, [checkSession, hasToken]);

  const tryLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    try {
      const res = await loginWorkshop(loginPass);
      if (res.token) setWorkshopToken(res.token);
      setLoginPass("");
      setGate("ok");
    } catch {
      setLoginErr("Anmeldung fehlgeschlagen.");
    }
  };

  const logout = useCallback(() => {
    setWorkshopToken(null);
    setGate("login");
  }, []);

  return {
    gate,
    setGate,
    loginPass,
    setLoginPass,
    loginErr,
    tryLogin,
    logout,
    recheck: checkSession,
  };
}
