const KEY = "rabbit_workshop_token";

export function getWorkshopToken(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setWorkshopToken(token: string | null): void {
  if (token) sessionStorage.setItem(KEY, token);
  else sessionStorage.removeItem(KEY);
}
