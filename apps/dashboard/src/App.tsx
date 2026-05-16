import { useEffect, useState, useCallback } from "react";

const API = window.location.origin;

// ─── Types ────────────────────────────────────────────────────────────────────

type Environment = {
  id: string;
  name: string;
  provider: string;
  region: string;
  template: string;
  status: string;
  ttl_hours: number;
  created_at: string;
};

type Deployment = {
  id: string;
  environment_id: string;
  environment_name: string;
  provider: string;
  status: string;
  retry_count: number;
  created_at: string;
  finished_at: string | null;
};

type DeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

type EnvironmentOutput = {
  output_key: string;
  output_value: string;
};

type TemplateInput = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  default?: string | number;
  options?: string[];
};

type PlatformTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  providers: string[];
  default_region: string;
  default_ttl_hours: number;
  inputs?: TemplateInput[];
};

type Tab = "dashboard" | "environments" | "deployments" | "new";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  if (status.includes("destroy")) return "text-amber-400 bg-amber-400/10 border-amber-400/30";
  if (status === "running") return "text-emerald-400 bg-emerald-400/10 border-emerald-400/30";
  if (status === "queued") return "text-sky-400 bg-sky-400/10 border-sky-400/30";
  if (status === "dispatching") return "text-violet-400 bg-violet-400/10 border-violet-400/30";
  if (status.includes("failed") || status.includes("permanent")) return "text-red-400 bg-red-400/10 border-red-400/30";
  if (status === "destroyed") return "text-neutral-500 bg-neutral-500/10 border-neutral-500/30";
  if (status === "success") return "text-emerald-400 bg-emerald-400/10 border-emerald-400/30";
  return "text-neutral-400 bg-neutral-400/10 border-neutral-400/30";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${statusColor(status)}`}>
      {(status === "running" || status === "dispatching") && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {status}
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ttlRemaining(createdAt: string, ttlHours: number): string {
  const expiresAt = new Date(createdAt).getTime() + ttlHours * 3600000;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expired";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, options);
  return res.json();
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono mb-4">
      {children}
    </p>
  );
}

function Card({ children, className = "", onClick }: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`border border-neutral-800 rounded-2xl bg-neutral-950 ${onClick ? "cursor-pointer hover:border-neutral-700 transition-colors" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-16 text-neutral-700 font-mono text-sm">
      {label}
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({
  environments,
  deployments,
  onNavigate,
}: {
  environments: Environment[];
  deployments: Deployment[];
  onNavigate: (tab: Tab) => void;
}) {
  const active = environments.filter(e => e.status === "running").length;
  const queued = environments.filter(e => ["queued", "dispatching"].includes(e.status)).length;
  const failed = environments.filter(e => e.status.includes("failed")).length;
  const expiring = environments.filter(e => {
    if (e.status !== "running") return false;
    const remaining = new Date(e.created_at).getTime() + e.ttl_hours * 3600000 - Date.now();
    return remaining > 0 && remaining < 3 * 3600000;
  }).length;

  const stats = [
    { label: "Active", value: active, color: "text-emerald-400", tab: "environments" as Tab },
    { label: "Queued", value: queued, color: "text-sky-400", tab: "environments" as Tab },
    { label: "Failed", value: failed, color: "text-red-400", tab: "environments" as Tab },
    { label: "Expiring soon", value: expiring, color: "text-amber-400", tab: "environments" as Tab },
  ];

  const recentDeployments = deployments.slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div>
        <SectionHeader>Overview</SectionHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <Card
              key={s.label}
              className="p-5"
              onClick={() => onNavigate(s.tab)}
            >
              <p className="text-neutral-600 text-xs font-mono uppercase tracking-wider mb-3">
                {s.label}
              </p>
              <p className={`text-4xl font-light tabular-nums ${s.color}`}>
                {s.value}
              </p>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <SectionHeader>Recent deployments</SectionHeader>
        {recentDeployments.length === 0 ? (
          <EmptyState label="no deployments yet" />
        ) : (
          <Card>
            <div className="divide-y divide-neutral-900">
              {recentDeployments.map(d => (
                <div key={d.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-200 truncate">
                        {d.environment_name}
                      </p>
                      <p className="text-xs text-neutral-600 font-mono mt-0.5">
                        {d.provider} · {timeAgo(d.created_at)}
                      </p>
                    </div>
                  </div>
                  <StatusPill status={d.status} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Providers */}
      <div>
        <SectionHeader>Providers</SectionHeader>
        <div className="grid grid-cols-2 gap-3">
          {["oracle", "hetzner"].map(p => {
            const count = environments.filter(e => e.provider === p && e.status === "running").length;
            return (
              <Card key={p} className="p-5">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm text-neutral-300">{p}</p>
                  <span className="text-xs text-neutral-600">{count} running</span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Environments Tab ─────────────────────────────────────────────────────────

function EnvironmentsTab({
  environments,
  onRefresh,
}: {
  environments: Environment[];
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, EnvironmentOutput[]>>({});

  const statuses = ["all", "running", "queued", "dispatching", "failed", "destroyed"];

  const filtered = environments
    .filter(e => filter === "all" || e.status === filter || (filter === "failed" && e.status.includes("failed")))
    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  async function loadOutputs(envId: string) {
    if (outputs[envId]) return;
    const data = await apiFetch<EnvironmentOutput[]>(`/api/environments/${envId}/outputs`);
    setOutputs(prev => ({ ...prev, [envId]: data }));
  }

  function toggleExpanded(id: string) {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      loadOutputs(id);
    }
  }

  async function destroyEnv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await apiFetch(`/api/environments/${id}/destroy`, { method: "POST" });
    onRefresh();
  }

  async function deleteEnv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this environment and all its data?")) return;
    await apiFetch(`/api/environments/${id}`, { method: "DELETE" });
    onRefresh();
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search environments..."
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600"
        />
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-colors ${
                filter === s
                  ? "bg-white text-black"
                  : "bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState label="no environments match" />
      ) : (
        <div className="space-y-2">
          {filtered.map(env => (
            <Card key={env.id} className="overflow-hidden">
              {/* Row */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-neutral-900/50 transition-colors"
                onClick={() => toggleExpanded(env.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-neutral-100 truncate">{env.name}</p>
                    <StatusPill status={env.status} />
                  </div>
                  <p className="text-xs text-neutral-600 font-mono mt-1">
                    {env.provider} · {env.region} · {env.template}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {env.status === "running" && (
                    <span className="text-xs text-neutral-600 font-mono hidden sm:block">
                      {ttlRemaining(env.created_at, env.ttl_hours)}
                    </span>
                  )}
                  {!["destroyed", "destroy_queued", "failed_permanent"].includes(env.status) && (
                    <button
                      onClick={e => destroyEnv(env.id, e)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-amber-900/60 text-amber-500 hover:bg-amber-950/40 transition-colors"
                    >
                      destroy
                    </button>
                  )}
                  <button
                    onClick={e => deleteEnv(env.id, e)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-900/60 text-red-500 hover:bg-red-950/40 transition-colors"
                  >
                    delete
                  </button>
                  <span className={`text-neutral-600 text-sm transition-transform duration-200 ${expanded === env.id ? "rotate-90" : ""}`}>
                    ›
                  </span>
                </div>
              </div>

              {/* Expanded: outputs */}
              {expanded === env.id && (
                <div className="border-t border-neutral-800/60 px-5 py-4 bg-neutral-950/80">
                  {outputs[env.id] === undefined ? (
                    <p className="text-xs text-neutral-700 font-mono">loading outputs...</p>
                  ) : outputs[env.id].length === 0 ? (
                    <p className="text-xs text-neutral-700 font-mono">no outputs captured yet</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-700 font-mono mb-3">
                        Runtime outputs
                      </p>
                      {outputs[env.id].map(o => (
                        <div key={o.output_key} className="flex items-start justify-between gap-6">
                          <span className="text-xs text-neutral-500 font-mono">{o.output_key}</span>
                          <code className="text-xs text-neutral-200 font-mono text-right">
                            {o.output_value.replace(/^"|"$/g, "")}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Deployments Tab ──────────────────────────────────────────────────────────

function DeploymentsTab({ deployments }: { deployments: Deployment[] }) {
  const [selected, setSelected] = useState<string | null>(
    deployments[0]?.id ?? null
  );
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchEvents(id: string, showLoading = false) {
    if (showLoading) setLoading(true);
    const data = await apiFetch<DeploymentEvent[]>(`/api/deployments/${id}/events`);
    setEvents(data);
    if (showLoading) setLoading(false);
  }

  async function selectDeployment(id: string) {
    setSelected(id);
    fetchEvents(id, true);
  }

  useEffect(() => {
    if (deployments[0]?.id) selectDeployment(deployments[0].id);
  }, []);

  // Auto-refresh events while selected deployment is in-progress
  useEffect(() => {
    if (!selected) return;
    const active = deployments.find(d => d.id === selected);
    const inProgress = active && !["success", "destroyed", "failed_permanent"].includes(active.status);
    if (!inProgress) return;
    const interval = setInterval(() => fetchEvents(selected), 3000);
    return () => clearInterval(interval);
  }, [selected, deployments]);

  const selectedDeployment = deployments.find(d => d.id === selected);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4">
      {/* Left: list */}
      <div className="space-y-2 md:max-h-[calc(100vh-220px)] md:overflow-y-auto pr-1">
        {deployments.length === 0 ? (
          <EmptyState label="no deployments yet" />
        ) : (
          deployments.map(d => (
            <Card
              key={d.id}
              className={`p-4 ${selected === d.id ? "border-neutral-600 bg-neutral-900" : ""}`}
              onClick={() => selectDeployment(d.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-200 truncate">
                    {d.environment_name}
                  </p>
                  <p className="text-xs text-neutral-600 font-mono mt-1">
                    {d.provider} · {timeAgo(d.created_at)}
                  </p>
                  {d.retry_count > 0 && (
                    <p className="text-xs text-amber-600 font-mono mt-1">
                      {d.retry_count} retr{d.retry_count === 1 ? "y" : "ies"}
                    </p>
                  )}
                </div>
                <StatusPill status={d.status} />
              </div>
              <p className="text-[10px] font-mono text-neutral-800 mt-3 truncate">{d.id}</p>
            </Card>
          ))
        )}
      </div>

      {/* Right: events */}
      <Card className="p-5 md:max-h-[calc(100vh-220px)] md:overflow-y-auto">
        {!selected ? (
          <EmptyState label="select a deployment" />
        ) : (
          <>
            {selectedDeployment && (
              <div className="mb-5 pb-4 border-b border-neutral-800">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="font-medium text-neutral-100">
                    {selectedDeployment.environment_name}
                  </p>
                  <StatusPill status={selectedDeployment.status} />
                </div>
                <p className="text-xs font-mono text-neutral-700 mt-1.5">{selected}</p>
              </div>
            )}
            {loading ? (
              <p className="text-xs text-neutral-700 font-mono">loading events...</p>
            ) : events.length === 0 ? (
              <EmptyState label="no events" />
            ) : (
              <div className="space-y-4">
                {events.map((ev, i) => (
                  <div key={ev.id} className="flex gap-4">
                    {/* Timeline line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                        ev.type === "success" || ev.type === "destroyed"
                          ? "bg-emerald-400"
                          : ev.type.includes("fail")
                          ? "bg-red-400"
                          : "bg-neutral-600"
                      }`} />
                      {i < events.length - 1 && (
                        <div className="w-px flex-1 bg-neutral-800/80 mt-1" />
                      )}
                    </div>
                    <div className="pb-4 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="text-sm font-mono text-neutral-300">{ev.type}</p>
                        <p className="text-[11px] text-neutral-700">
                          {new Date(ev.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className="text-xs text-neutral-600 mt-1 break-words">{ev.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ─── New Environment Tab ───────────────────────────────────────────────────────

function NewEnvironmentTab({
  templates,
  onSuccess,
}: {
  templates: PlatformTemplate[];
  onSuccess: () => void;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("hetzner");
  const [inputValues, setInputValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tmpl = templates.find(t => t.id === selectedTemplate);

  async function create() {
    if (!name.trim() || !tmpl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<any>("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider,
          region: tmpl.default_region,
          template: tmpl.id,
          ttl_hours: tmpl.default_ttl_hours,
          inputs: inputValues,
        }),
      });
      if (res.error) {
        setError(res.error);
      } else {
        setName("");
        setInputValues({});
        onSuccess();
      }
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* Template picker */}
      <div>
        <SectionHeader>Template</SectionHeader>
        <div className="space-y-2">
          {templates.map(t => (
            <Card
              key={t.id}
              className={`p-4 ${selectedTemplate === t.id ? "border-neutral-500" : ""}`}
              onClick={() => setSelectedTemplate(t.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-neutral-200">{t.name}</p>
                  <p className="text-xs text-neutral-600 mt-1">{t.description}</p>
                </div>
                <span className="text-[10px] font-mono uppercase text-neutral-700 border border-neutral-800 rounded px-2 py-0.5 ml-4 shrink-0">
                  {t.category}
                </span>
              </div>
              <div className="flex gap-1.5 mt-3">
                {t.providers.map(p => (
                  <span key={p} className="text-[10px] font-mono text-neutral-600 border border-neutral-800 rounded px-2 py-0.5">
                    {p}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Config */}
      <div>
        <SectionHeader>Configuration</SectionHeader>
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
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-600 transition-colors appearance-none"
            >
              {(tmpl?.providers ?? ["oracle", "hetzner"]).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {tmpl?.inputs?.map(input => (
            <div key={input.key}>
              <label className="text-xs text-neutral-600 font-mono block mb-1.5">{input.label}</label>
              {input.type === "select" ? (
                <select
                  value={inputValues[input.key] ?? input.default ?? ""}
                  onChange={e => setInputValues(prev => ({ ...prev, [input.key]: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-600 transition-colors appearance-none"
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

      {/* TTL info */}
      {tmpl && (
        <p className="text-xs text-neutral-700 font-mono">
          TTL: {tmpl.default_ttl_hours}h · region: {tmpl.default_region}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500 font-mono bg-red-950/30 border border-red-900/40 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <button
        onClick={create}
        disabled={!name.trim() || loading}
        className="w-full bg-white text-black rounded-xl py-3 text-sm font-semibold hover:bg-neutral-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {loading ? "creating..." : "create environment"}
      </button>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [templates, setTemplates] = useState<PlatformTemplate[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const loadAll = useCallback(async () => {
    const [tmpl, envs, deps] = await Promise.all([
      apiFetch<PlatformTemplate[]>("/api/templates"),
      apiFetch<Environment[]>("/api/environments"),
      apiFetch<Deployment[]>("/api/deployments"),
    ]);
    setTemplates(tmpl);
    setEnvironments(envs);
    setDeployments(deps);
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "environments", label: "Environments" },
    { id: "deployments", label: "Deployments" },
    { id: "new", label: "New" },
  ];

  return (
    <div className="min-h-screen bg-[#080808] text-neutral-200">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-700 font-mono">
            infrastructure control plane
          </p>
          <h1 className="text-3xl font-light tracking-tight mt-1.5 text-neutral-100">
            platform-infra
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-neutral-900 pb-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-mono transition-colors relative -mb-px ${
                tab === t.id
                  ? "text-neutral-100 border-b-2 border-white"
                  : "text-neutral-600 hover:text-neutral-400"
              }`}
            >
              {t.label}
              {t.id === "environments" && environments.filter(e => e.status === "running").length > 0 && (
                <span className="ml-2 text-[10px] bg-emerald-400/15 text-emerald-400 rounded-full px-1.5 py-0.5">
                  {environments.filter(e => e.status === "running").length}
                </span>
              )}
              {t.id === "deployments" && deployments.filter(d => d.status === "dispatching").length > 0 && (
                <span className="ml-2 text-[10px] bg-violet-400/15 text-violet-400 rounded-full px-1.5 py-0.5">
                  {deployments.filter(d => d.status === "dispatching").length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "dashboard" && (
          <DashboardTab
            environments={environments}
            deployments={deployments}
            onNavigate={setTab}
          />
        )}
        {tab === "environments" && (
          <EnvironmentsTab
            environments={environments}
            onRefresh={loadAll}
          />
        )}
        {tab === "deployments" && (
          <DeploymentsTab deployments={deployments} />
        )}
        {tab === "new" && (
          <NewEnvironmentTab
            templates={templates}
            onSuccess={() => {
              loadAll();
              setTab("environments");
            }}
          />
        )}

      </div>
    </div>
  );
}
