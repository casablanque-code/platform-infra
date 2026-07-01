import { useEffect, useState } from "react";
import type { ApiKey } from "../types";
import { useAuthFetch, LIME } from "../api";
import { Card, SectionLabel, EmptyState, DeleteConfirm, timeAgo } from "./ui";

const ROLE_COLORS: Record<string, string> = {
  admin:    "text-red-400 bg-red-400/10 border-red-400/25",
  operator: "text-amber-400 bg-amber-400/10 border-amber-400/25",
  viewer:   "text-sky-400 bg-sky-400/10 border-sky-400/25",
};

export function KeysTab() {
  const authFetch = useAuthFetch();
  const [keys, setKeys]               = useState<ApiKey[]>([]);
  const [name, setName]               = useState("");
  const [role, setRole]               = useState<"operator" | "viewer">("operator");
  const [expiresInDays, setExpires]   = useState<number | null>(30);
  const [creating, setCreating]       = useState(false);
  const [newKey, setNewKey]           = useState<string | null>(null);
  const [confirming, setConfirming]   = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);

  async function loadKeys() {
    const data = await authFetch<ApiKey[]>("/api/keys");
    setKeys(data);
  }

  useEffect(() => { loadKeys(); }, []);

  async function createKey() {
    if (!name.trim()) return;
    setCreating(true);
    const res = await authFetch<{ ok: boolean; key: string; expires_at: string | null }>("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), role, expires_in_days: expiresInDays }),
    });
    setNewKey(res.key);
    setName("");
    setCreating(false);
    loadKeys();
  }

  async function deleteKey(id: string) {
    await authFetch(`/api/keys/${id}`, { method: "DELETE" });
    setConfirming(null);
    loadKeys();
  }

  function copyKey(k: string) {
    navigator.clipboard.writeText(k);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <SectionLabel>API Keys</SectionLabel>

      {newKey && (
        <div className="border border-emerald-900/50 rounded-2xl p-5 bg-emerald-950/20 space-y-3">
          <p className="text-xs text-emerald-400 font-mono uppercase tracking-wider">
            Key created — copy it now, it won't be shown again
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 text-xs font-mono text-neutral-200 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 break-all">
              {newKey}
            </code>
            <button
              onClick={() => copyKey(newKey)}
              className="shrink-0 text-xs px-3 py-3 rounded-lg border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors"
            >
              {copied ? "✓" : "copy"}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-neutral-700 hover:text-neutral-500 font-mono transition-colors"
          >
            dismiss
          </button>
        </div>
      )}

      <Card className="p-5 space-y-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono">Create new key</p>
        <div className="flex gap-3 flex-wrap">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. alice-dev"
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600 transition-colors min-w-[160px]"
          />
          <div className="flex gap-1.5">
            {(["operator", "viewer"] as const).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`px-3 py-2 rounded-lg text-xs font-mono transition-colors border ${
                  role === r ? "bg-white text-black border-white" : "border-neutral-800 text-neutral-500 hover:border-neutral-600"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {([7, 30, 90, null] as (number | null)[]).map(d => (
              <button
                key={d ?? "never"}
                onClick={() => setExpires(d)}
                className={`px-3 py-2 rounded-lg text-xs font-mono transition-colors border ${
                  expiresInDays === d ? "bg-white text-black border-white" : "border-neutral-800 text-neutral-500 hover:border-neutral-600"
                }`}
              >
                {d ? `${d}d` : "∞"}
              </button>
            ))}
          </div>
          <button
            onClick={createKey}
            disabled={!name.trim() || creating}
            style={{ backgroundColor: name.trim() && !creating ? LIME : undefined }}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all disabled:opacity-30 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed"
          >
            {creating ? "..." : "create"}
          </button>
        </div>
        <div className="text-xs text-neutral-700 font-mono space-y-0.5">
          <p><span className="text-amber-400">operator</span> — create environments, destroy, run actions</p>
          <p><span className="text-sky-400">viewer</span> — read-only access to all resources</p>
        </div>
      </Card>

      {keys.length === 0 ? (
        <EmptyState label="no api keys yet" sub="admin key is set via wrangler secret" />
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <Card key={k.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-neutral-200">{k.name}</p>
                    <span className={`text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${ROLE_COLORS[k.role]}`}>
                      {k.role}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-700 font-mono mt-1">
                    created {timeAgo(k.created_at)}
                    {k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : " · never used"}
                    {k.expires_at && (() => {
                      const expired = new Date(k.expires_at).getTime() < Date.now();
                      return (
                        <span className={expired ? " · text-red-500" : " · text-neutral-600"}>
                          {expired ? " expired" : ` · expires ${timeAgo(k.expires_at).replace(" ago", "")}`}
                        </span>
                      );
                    })()}
                  </p>
                </div>
                {confirming === k.id ? (
                  <DeleteConfirm
                    onConfirm={() => deleteKey(k.id)}
                    onCancel={() => setConfirming(null)}
                  />
                ) : (
                  <button
                    onClick={() => setConfirming(k.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-900/50 text-red-500 hover:bg-red-950/40 transition-colors shrink-0"
                  >
                    revoke
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
