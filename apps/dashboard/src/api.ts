import { createContext, useContext } from "react";

const API = window.location.origin;
export const LIME = "#CBFF4D";

export function authedFetch<T>(path: string, key: string, options?: RequestInit): Promise<T> {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      "Authorization": `Bearer ${key}`,
    },
  }).then(async r => {
    if (r.status === 401) throw new Error("unauthorized");
    return r.json() as Promise<T>;
  });
}

export const AuthContext = createContext<string>("");

/** Hook: returns a fetch function bound to the API key in context. */
export function useAuthFetch() {
  const key = useContext(AuthContext);
  return <T>(path: string, options?: RequestInit) => authedFetch<T>(path, key, options);
}
