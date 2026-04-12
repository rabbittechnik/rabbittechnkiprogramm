import { useCallback, useEffect, useState } from "react";
import { fetchAuthStatus, loginWorkshop } from "./api";
import { getWorkshopToken, getWorkshopTokenRole, setWorkshopToken } from "./workshopAuth";

export type BenchGateState = "loading" | "login" | "ok" | "no_bench";

/**
 * Montage-Tablet: eigenes Passwort (RABBIT_BENCH_PASSWORD), Token-Rolle „bench“.
 */
export function useBenchGate() {
  const [gate, setGate] = useState<BenchGateState>("loading");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [noBenchHint, setNoBenchHint] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const s = await fetchAuthStatus();
      if (!s.workshopAuthRequired) {
        setGate("ok");
        return;
      }
      if (!s.benchAuthConfigured) {
        setNoBenchHint(
          "Montage-Anmeldung ist nicht eingerichtet. Bitte RABBIT_BENCH_PASSWORD auf dem Server setzen."
        );
        setGate("no_bench");
        return;
      }
      if (getWorkshopToken() && getWorkshopTokenRole() === "bench") {
        setGate("ok");
        return;
      }
      setGate("login");
    } catch {
      if (getWorkshopToken() && getWorkshopTokenRole() === "bench") {
        setGate("ok");
      } else {
        setGate("login");
      }
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const tryLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    try {
      const res = await loginWorkshop(loginPass, "bench");
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
    loginPass,
    setLoginPass,
    loginErr,
    tryLogin,
    logout,
    noBenchHint,
    recheck: checkSession,
  };
}
