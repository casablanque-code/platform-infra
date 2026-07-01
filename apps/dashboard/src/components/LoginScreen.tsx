import { useState } from "react";
import { authedFetch, LIME } from "../api";

export function LoginScreen({ onLogin }: { onLogin: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState(false);

  async function attempt() {
    if (!key.trim()) return;
    try {
      await authedFetch("/api/templates", key.trim());
      localStorage.setItem("pinfra_key", key.trim());
      onLogin(key.trim());
    } catch {
      setError(true);
    }
  }

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-light">
            <span className="text-neutral-100">platform</span>
            <span style={{ color: LIME }}>-infra</span>
          </h1>
          <p className="text-xs text-neutral-600 font-mono mt-2">enter your api key</p>
        </div>
        <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950 space-y-4">
          <input
            type="password"
            value={key}
            onChange={e => { setKey(e.target.value); setError(false); }}
            onKeyDown={e => e.key === "Enter" && attempt()}
            placeholder="pinfra_..."
            className={`w-full bg-neutral-900 border rounded-xl px-4 py-3 text-sm font-mono placeholder:text-neutral-700 focus:outline-none transition-colors ${
              error ? "border-red-900/60" : "border-neutral-800 focus:border-neutral-600"
            }`}
          />
          {error && <p className="text-xs text-red-500 font-mono">invalid key</p>}
          <button
            onClick={attempt}
            disabled={!key.trim()}
            style={{ backgroundColor: key.trim() ? LIME : undefined }}
            className="w-full rounded-xl py-3 text-sm font-semibold text-black transition-all disabled:opacity-30 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed"
          >
            sign in
          </button>
        </div>
      </div>
    </div>
  );
}
