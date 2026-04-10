import { useCallback, useEffect, useState } from "react";
import { fetchAuthStatus, loginWorkshop } from "./api";
import { getWorkshopToken, setWorkshopToken } from "./workshopAuth";

export type WorkshopGateState = "loading" | "login" | "ok";

export function useWorkshopGate() {
  const [gate, setGate] = useState<WorkshopGateState>("loading");
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
      setGate("login");
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

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
