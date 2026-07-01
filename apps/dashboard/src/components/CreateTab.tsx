import { useEffect, useState } from "react";
import { PlatformTemplate } from "../types";
import { useAuthFetch, LIME } from "../api";

const TTL_OPTIONS = [
  { label: "1h",  value: 1    },
  { label: "6h",  value: 6    },
  { label: "24h", value: 24   },
  { label: "72h", value: 72   },
  { label: "7d",  value: 168  },
  { label: "∞",   value: 8760 },
];

export function CreateTab({ templates, onSuccess }: { templates: PlatformTemplate[]; onSuccess: () => void }) {
  const authFetch = useAuthFetch();
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.id ?? "");
  const [name, setName]                         = useState("");
  const [provider, setProvider]                 = useState("");
  const [inputValues, setInputValues]           = useState<Record<string, any>>({});
  const [ttlHours, setTtlHours]                 = useState<number | null>(null);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState<string | null>(null);

  const tmpl        = templates.find(t => t.id === selectedTemplate);
  const effectiveTtl = ttlHours ?? tmpl?.default_ttl_hours ?? 72;

  useEffect(() => {
    if (tmpl?.providers[0]) setProvider(tmpl.providers[0]);
  }, [selectedTemplate]);

  async function create() {
    if (!name.trim() || !tmpl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch<any>("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          region: tmpl.default_region,
          template: tmpl.id,
          ttl_hours: effectiveTtl,
          inputs: inputValues,
        }),
      });
      if (res.error) {
        setError(res.error);
      } else {
        setName("");
        setInputValues({});
        setTtlHours(null);
        onSuccess();
      }
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-7">

      {/* Template picker */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono mb-3">Template</p>
        <div className="space-y-2">
          {templates.map(t => {
            const active = selectedTemplate === t.id;
            return (
              <div
                key={t.id}
                onClick={() => setSelectedTemplate(t.id)}
                className={`border rounded-2xl p-4 cursor-pointer transition-all ${
                  active
                    ? "border-[#CBFF4D]/50 bg-[#CBFF4D]/5"
                    : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`font-medium transition-colors ${active ? "text-[#CBFF4D]" : "text-neutral-200"}`}>
                      {t.name}
                    </p>
                    <p className="text-xs text-neutral-600 mt-1">{t.description}</p>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-neutral-700 border border-neutral-800 rounded px-2 py-0.5 ml-4 shrink-0">
                    {t.category}
                  </span>
                </div>
                <div className="flex gap-1.5 mt-3">
                  {t.providers.map(p => (
                    <span key={p} className="text-[10px] font-mono text-neutral-600 border border-neutral-800 rounded px-2 py-0.5">{p}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Config */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono mb-3">Configuration</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-600 font-mono block mb-1.5">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-env"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-600 font-mono block mb-1.5">Provider</label>
            <div className="flex gap-2 flex-wrap">
              {(tmpl?.providers ?? []).map(p => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
                    provider === p ? "bg-white text-black" : "bg-neutral-900 border border-neutral-800 text-neutral-500 hover:border-neutral-600"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-600 font-mono block mb-1.5">Lifetime</label>
            <div className="flex gap-2 flex-wrap">
              {TTL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTtlHours(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-mono transition-colors ${
                    effectiveTtl === opt.value ? "bg-white text-black" : "bg-neutral-900 border border-neutral-800 text-neutral-500 hover:border-neutral-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-700 font-mono mt-1.5">
              {effectiveTtl >= 8760 ? "no auto-destroy" : `auto-destroy after ${effectiveTtl}h`}
            </p>
          </div>

          {tmpl?.inputs?.map(input => (
            <div key={input.key}>
              <label className="text-xs text-neutral-600 font-mono block mb-1.5">{input.label}</label>
              {input.type === "select" ? (
                <select
                  value={inputValues[input.key] ?? input.default ?? ""}
                  onChange={e => setInputValues(prev => ({ ...prev, [input.key]: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-600 transition-colors"
                >
                  {input.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={input.type === "number" ? "number" : "text"}
                  value={inputValues[input.key] ?? input.default ?? ""}
                  onChange={e => setInputValues(prev => ({
                    ...prev,
                    [input.key]: input.type === "number" ? Number(e.target.value) : e.target.value,
                  }))}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-600 transition-colors"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 font-mono bg-red-950/30 border border-red-900/40 rounded-lg px-4 py-3">{error}</p>
      )}

      <button
        onClick={create}
        disabled={!name.trim() || !provider || loading}
        style={{ backgroundColor: (!name.trim() || !provider || loading) ? undefined : LIME }}
        className="w-full rounded-xl py-3 text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 text-black"
      >
        {loading ? "creating..." : "create environment"}
      </button>
    </div>
  );
}
