import { useEffect, useState, useCallback, useRef, createContext } from "react";
import { createPortal } from "react-dom";

const API = window.location.origin;
const LIME = "#CBFF4D";

function authedFetch<T>(path: string, key: string, options?: RequestInit): Promise<T> {
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

type InfraNode = {
  id: string;
  environment_id: string;
  environment_name: string;
  provider: string;
  hostname: string | null;
  public_ip: string | null;
  agent_version: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
};

type DeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

type Action = {
  id: string;
  environment_id: string;
  environment_name: string;
  type: string;
  status: string;
  params: string | null;
  created_at: string;
  finished_at: string | null;
};

type AuditEntry = {
  id: string;
  actor: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  meta: string | null;
  created_at: string;
};

type ApiKey = {
  id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_by: string;
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

type Tab = "dashboard" | "environments" | "deployments" | "nodes" | "create" | "keys" | "audit";

// ─── API ──────────────────────────────────────────────────────────────────────

// Auth context
const AuthContext = createContext<string>("");
function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Fallback: read from localStorage directly for module-level calls
  const key = localStorage.getItem("pinfra_key") ?? "";
  return authedFetch<T>(path, key, options);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  if (status === "running" || status === "success")
    return { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25" };
  if (status === "destroyed")
    return { text: "text-neutral-500", bg: "bg-neutral-500/10", border: "border-neutral-500/25" };
  if (status === "queued")
    return { text: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/25" };
  if (status === "dispatching" || status === "workflow_dispatched")
    return { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/25" };
  if (status.includes("destroy"))
    return { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/25" };
  if (status.includes("failed") || status.includes("permanent"))
    return { text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/25" };
  return { text: "text-neutral-500", bg: "bg-neutral-500/10", border: "border-neutral-500/25" };
}

function StatusPill({ status }: { status: string }) {
  const c = statusColor(status);
  const active = status === "running" || status === "dispatching";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${c.text} ${c.bg} ${c.border}`}>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status}
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - parseUTC(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function parseUTC(iso: string): number {
  // Ensure UTC parsing even if Z is missing (SQLite datetime quirk)
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(s).getTime();
}

function ttlInfo(createdAt: string, ttlHours: number): { label: string; pct: number; urgent: boolean } {
  if (!ttlHours || ttlHours >= 8760) return { label: "no auto-destroy", pct: 100, urgent: false };
  const created = parseUTC(createdAt);
  const expiresAt = created + ttlHours * 3600_000;
  const totalMs = ttlHours * 3600_000;
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return { label: "expired", pct: 0, urgent: true };
  const pct = Math.round((remainingMs / totalMs) * 100);
  const urgent = remainingMs < 3 * 3600_000;
  const h = Math.floor(remainingMs / 3600_000);
  const m = Math.floor((remainingMs % 3600_000) / 60_000);
  const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  return { label, pct, urgent };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono mb-3">
      {children}
    </p>
  );
}

function EmptyState({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-neutral-700 font-mono text-sm">{label}</p>
      {sub && <p className="text-neutral-800 font-mono text-xs mt-1">{sub}</p>}
    </div>
  );
}

function DeleteConfirm({ onConfirm, onCancel, label = "Delete?" }: {
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 font-mono">{label}</span>
      <button onClick={onConfirm} className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-400 border border-red-900/60 hover:bg-red-900/60 transition-colors">yes</button>
      <button onClick={onCancel} className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-500 hover:bg-neutral-700 transition-colors">no</button>
    </div>
  );
}

// ─── Playbook Dropdown (portal) ───────────────────────────────────────────────

function PlaybookDropdown({
  anchorRef,
  playbooks,
  selected,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  playbooks: { id: string; label: string; desc: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 220),
    });
  }, [anchorRef]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  return createPortal(
    <div
      style={{ position: "absolute", top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden shadow-2xl shadow-black/80"
      onMouseDown={e => e.stopPropagation()}
    >
      {playbooks.map((pb, i) => (
        <button
          key={pb.id}
          onClick={() => { onSelect(pb.id); onClose(); }}
          className={`w-full text-left px-4 py-3 transition-colors hover:bg-neutral-800 ${
            i < playbooks.length - 1 ? "border-b border-neutral-800" : ""
          } ${selected === pb.id ? "bg-neutral-800/60" : ""}`}
        >
          <p className="text-xs font-mono text-neutral-200">{pb.label}</p>
          <p className="text-[11px] text-neutral-600 mt-0.5">{pb.desc}</p>
        </button>
      ))}
    </div>,
    document.body
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardTab({
  environments, deployments, nodes, templates, onNavigate,
}: {
  environments: Environment[];
  deployments: Deployment[];
  nodes: InfraNode[];
  templates: PlatformTemplate[];
  onNavigate: (tab: Tab) => void;
}) {
  const envStats = {
    active: environments.filter(e => e.status === "running").length,
    queued: environments.filter(e => ["queued", "dispatching"].includes(e.status)).length,
    failed: environments.filter(e => e.status.includes("failed")).length,
    expiring: environments.filter(e => {
      if (e.status !== "running") return false;
      return (new Date(e.created_at).getTime() + e.ttl_hours * 3_600_000 - Date.now()) < 3 * 3_600_000;
    }).length,
  };

  const deployStats = {
    running: deployments.filter(d => d.status === "dispatching").length,
    failed: deployments.filter(d => d.status.includes("failed")).length,
  };

  const nodeStats = {
    online: nodes.filter(n => n.status === "online").length,
    unreachable: nodes.filter(n => n.status === "unreachable").length,
  };

  const allProviders = [...new Set(templates.flatMap(t => t.providers))].sort();

  return (
    <div className="space-y-8">

      {/* Environments */}
      <div>
        <SectionLabel>Environments</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active", value: envStats.active, color: "text-emerald-400" },
            { label: "Queued", value: envStats.queued, color: "text-sky-400" },
            { label: "Failed", value: envStats.failed, color: "text-red-400" },
            { label: "Expiring", value: envStats.expiring, color: "text-amber-400" },
          ].map(s => (
            <Card key={s.label} className="p-5" onClick={() => onNavigate("environments")}>
              <p className="text-[11px] uppercase tracking-wider text-neutral-600 font-mono mb-3">{s.label}</p>
              <p className={`text-4xl font-light tabular-nums ${s.color}`}>{s.value}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Deployments + Nodes side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionLabel>Deployments</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "In progress", value: deployStats.running, color: "text-violet-400" },
              { label: "Failed", value: deployStats.failed, color: "text-red-400" },
            ].map(s => (
              <Card key={s.label} className="p-5" onClick={() => onNavigate("deployments")}>
                <p className="text-[11px] uppercase tracking-wider text-neutral-600 font-mono mb-3">{s.label}</p>
                <p className={`text-4xl font-light tabular-nums ${s.color}`}>{s.value}</p>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel>Nodes</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Online", value: nodeStats.online, color: "text-emerald-400" },
              { label: "Unreachable", value: nodeStats.unreachable, color: "text-red-400" },
            ].map(s => (
              <Card key={s.label} className="p-5" onClick={() => onNavigate("nodes")}>
                <p className="text-[11px] uppercase tracking-wider text-neutral-600 font-mono mb-3">{s.label}</p>
                <p className={`text-4xl font-light tabular-nums ${s.color}`}>{s.value}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Providers */}
      <div>
        <SectionLabel>Providers</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {allProviders.map(p => {
            const running = environments.filter(e => e.provider === p && e.status === "running").length;
            const total = environments.filter(e => e.provider === p).length;
            const lost = nodes.filter(n => n.provider === p && n.status === "unreachable").length;
            return (
              <Card key={p} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-sm text-neutral-300">{p}</p>
                  {lost > 0 && <span className="text-[10px] text-red-400 font-mono">{lost} node lost</span>}
                </div>
                <p className="text-xs text-neutral-600">
                  {running} running{total > running ? ` · ${total - running} other` : ""}
                </p>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recent deployments */}
      <div>
        <SectionLabel>Recent activity</SectionLabel>
        {deployments.length === 0 ? (
          <EmptyState label="no deployments yet" />
        ) : (
          <Card>
            <div className="divide-y divide-neutral-900">
              {deployments.slice(0, 6).map(d => (
                <div key={d.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-200 truncate">{d.environment_name}</p>
                    <p className="text-xs text-neutral-600 font-mono mt-0.5">{d.provider} · {timeAgo(d.created_at)}</p>
                  </div>
                  <StatusPill status={d.status} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

    </div>
  );
}

// ─── Environments ─────────────────────────────────────────────────────────────

function EnvironmentsTab({
  environments, nodes, onRefresh,
}: {
  environments: Environment[];
  nodes: InfraNode[];
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, EnvironmentOutput[]>>({});
  const [confirming, setConfirming] = useState<{ id: string; action: "destroy" | "delete" } | null>(null);
  const [actions, setActions] = useState<Record<string, Action[]>>({});
  const [runningAction, setRunningAction] = useState<Record<string, boolean>>({});
  const [playbookOpen, setPlaybookOpen] = useState<string | null>(null);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Record<string, string>>({});
  const dropdownRefs = useRef<Record<string, React.RefObject<HTMLButtonElement | null>>>({});

  function getDropdownRef(envId: string) {
    if (!dropdownRefs.current[envId]) {
      dropdownRefs.current[envId] = { current: null };
    }
    return dropdownRefs.current[envId];
  }

  const statuses = ["all", "running", "queued", "dispatching", "failed", "destroyed"];

  const filtered = environments
    .filter(e => filter === "all" || e.status === filter || (filter === "failed" && e.status.includes("failed")))
    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  async function loadOutputs(envId: string) {
    if (outputs[envId] !== undefined) return;
    const data = await authFetch<EnvironmentOutput[]>(`/api/environments/${envId}/outputs`);
    setOutputs(prev => ({ ...prev, [envId]: data }));
  }

  async function loadActions(envId: string) {
    const data = await authFetch<Action[]>(`/api/environments/${envId}/actions`);
    setActions(prev => ({ ...prev, [envId]: data }));
  }

  function toggleExpanded(id: string) {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next) {
      loadOutputs(next);
      loadActions(next);
    }
  }

  async function runAction(envId: string, type: string, params?: Record<string, any>) {
    setRunningAction(prev => ({ ...prev, [envId]: true }));
    await authFetch(`/api/environments/${envId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, params }),
    });
    await loadActions(envId);
    setRunningAction(prev => ({ ...prev, [envId]: false }));
  }

  async function doDestroy(id: string) {
    await authFetch(`/api/environments/${id}/destroy`, { method: "POST" });
    setConfirming(null);
    onRefresh();
  }

  async function doDelete(id: string) {
    await authFetch(`/api/environments/${id}`, { method: "DELETE" });
    setConfirming(null);
    onRefresh();
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm placeholder:text-neutral-700 focus:outline-none focus:border-neutral-700 transition-colors"
        />
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider transition-colors ${
                filter === s ? "bg-white text-black" : "bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState label="no environments match" />
      ) : (
        <div className="space-y-2">
          {filtered.map(env => {
            const node = nodes.find(n => n.environment_id === env.id);
            const ttl = ttlInfo(env.created_at, env.ttl_hours);
            const isExpanded = expanded === env.id;
            const isConfirming = confirming?.id === env.id;

            return (
              <Card key={env.id} className="overflow-hidden">
                {/* Main row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => !isConfirming && toggleExpanded(env.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-medium text-neutral-100">{env.name}</p>
                      <StatusPill status={env.status} />
                      {/* Node health indicator */}
                      {node && (
                        <span className={`text-[10px] font-mono ${node.status === "online" ? "text-emerald-500" : "text-red-400"}`}>
                          {node.status === "online" ? "● node online" : "● node lost"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 font-mono mt-1">
                      {env.provider} · {env.region} · {env.template}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* TTL */}
                    {env.status === "running" && ttl.label !== "no auto-destroy" && (
                      <span className={`text-xs font-mono hidden sm:block ${ttl.urgent ? "text-amber-400" : "text-neutral-600"}`}>
                        {ttl.label}
                      </span>
                    )}

                    {/* Actions */}
                    {isConfirming ? (
                      <DeleteConfirm
                        label={confirming!.action === "destroy" ? "Destroy?" : "Delete?"}
                        onConfirm={() => confirming!.action === "destroy" ? doDestroy(env.id) : doDelete(env.id)}
                        onCancel={() => setConfirming(null)}
                      />
                    ) : (
                      <>
                        {!["destroyed", "destroy_queued", "failed_permanent"].includes(env.status) && (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirming({ id: env.id, action: "destroy" }); }}
                            className="text-xs px-3 py-1.5 rounded-lg border border-amber-900/50 text-amber-500 hover:bg-amber-950/40 transition-colors"
                          >
                            destroy
                          </button>
                        )}
                        {(() => {
                          const canDelete = ["destroyed", "failed_permanent"].includes(env.status);
                          return (
                            <button
                              onClick={e => { e.stopPropagation(); if (canDelete) setConfirming({ id: env.id, action: "delete" }); }}
                              disabled={!canDelete}
                              title={canDelete ? undefined : "destroy first"}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                                canDelete
                                  ? "border-red-900/50 text-red-500 hover:bg-red-950/40"
                                  : "border-neutral-800 text-neutral-700 cursor-not-allowed"
                              }`}
                            >
                              delete
                            </button>
                          );
                        })()}
                      </>
                    )}

                    <span className={`text-neutral-600 text-sm transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>›</span>
                  </div>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="border-t border-neutral-800/50 px-5 py-4 bg-neutral-950/60 space-y-4">
                    {/* TTL bar */}
                    {env.status === "running" && ttl.label !== "no auto-destroy" && (
                      <div>
                        <div className="flex justify-between text-[11px] font-mono mb-1.5">
                          <span className="text-neutral-700 uppercase tracking-wider">Lifetime</span>
                          <span className={ttl.urgent ? "text-amber-400" : "text-neutral-500"}>{ttl.label}</span>
                        </div>
                        <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${ttl.urgent ? "bg-amber-400" : "bg-emerald-500"}`}
                            style={{ width: `${ttl.pct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Node info */}
                    {node && (
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className="text-neutral-700 uppercase tracking-wider text-[11px]">Node</span>
                        <span className={node.status === "online" ? "text-emerald-400" : "text-red-400"}>{node.status}</span>
                        {node.hostname && <span className="text-neutral-500">{node.hostname}</span>}
                        {node.public_ip && <span className="text-neutral-500">{node.public_ip}</span>}
                        <span className="text-neutral-700">seen {timeAgo(node.last_seen_at)}</span>
                      </div>
                    )}

                    {/* Outputs */}
                    {outputs[env.id] === undefined ? (
                      <p className="text-xs text-neutral-700 font-mono">loading outputs...</p>
                    ) : outputs[env.id].length === 0 ? (
                      <p className="text-xs text-neutral-700 font-mono">no outputs yet</p>
                    ) : (
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-700 font-mono mb-3">Outputs</p>
                        <div className="space-y-2">
                          {outputs[env.id].map(o => (
                            <div key={o.output_key} className="flex items-start justify-between gap-6">
                              <span className="text-xs text-neutral-600 font-mono">{o.output_key}</span>
                              <code className="text-xs text-neutral-200 font-mono text-right">{o.output_value.replace(/^"|"$/g, "")}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Runtime actions */}
                    {env.status === "running" && (() => {
                      // Playbooks per template
                      const PLAYBOOKS: Record<string, { id: string; label: string; desc: string }[]> = {
                        "docker-host": [
                          { id: "install_portainer", label: "Install Portainer", desc: "Web UI for Docker management" },
                          { id: "install_node_exporter", label: "Install Node Exporter", desc: "Prometheus metrics endpoint" },
                          { id: "install_uptime_kuma", label: "Install Uptime Kuma", desc: "Self-hosted uptime monitoring" },
                        ],
                        "postgres": [
                          { id: "install_pgadmin", label: "Install pgAdmin", desc: "Web UI for PostgreSQL" },
                          { id: "backup_to_r2", label: "Backup to R2", desc: "Dump database to Cloudflare R2" },
                        ],
                      };
                      const playbooks = PLAYBOOKS[env.template] ?? [];
                      const currentPlaybook = selectedPlaybook[env.id] ?? playbooks[0]?.id ?? "";

                      return (
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-700 font-mono mb-3">Actions</p>
                          <div className="flex gap-2 flex-wrap items-start">

                            {/* reboot */}
                            <button
                              disabled={!!runningAction[env.id]}
                              onClick={() => runAction(env.id, "reboot")}
                              className="text-xs px-3 py-1.5 rounded-lg border font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-amber-400 border-amber-900/40 hover:bg-amber-950/30"
                            >
                              {runningAction[env.id] ? "..." : "reboot"}
                            </button>

                            {/* run playbook with dropdown */}
                            {playbooks.length > 0 && (
                              <div className="relative">
                                <div className="flex rounded-lg border border-sky-900/40 overflow-hidden">
                                  {/* Run button */}
                                  <button
                                    disabled={!!runningAction[env.id]}
                                    onClick={() => {
                                      const pb = playbooks.find(p => p.id === currentPlaybook);
                                      if (pb) runAction(env.id, "run_script", { script: `bootstrap/${pb.id}.sh` });
                                    }}
                                    className="text-xs px-3 py-1.5 font-mono text-sky-400 hover:bg-sky-950/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {runningAction[env.id] ? "..." : "run"}
                                  </button>
                                  {/* Divider */}
                                  <div className="w-px bg-sky-900/40" />
                                  {/* Dropdown toggle */}
                                  <button
                                    ref={getDropdownRef(env.id) as React.RefObject<HTMLButtonElement>}
                                    onClick={e => { e.stopPropagation(); setPlaybookOpen(playbookOpen === env.id ? null : env.id); }}
                                    className="text-xs px-2 py-1.5 font-mono text-sky-400 hover:bg-sky-950/30 transition-colors flex items-center gap-1"
                                  >
                                    <span className="max-w-[120px] truncate text-sky-300/70">
                                      {playbooks.find(p => p.id === currentPlaybook)?.label ?? "select"}
                                    </span>
                                    <span className={`transition-transform duration-150 ${playbookOpen === env.id ? "rotate-180" : ""}`}>▾</span>
                                  </button>
                                </div>

                                {/* Dropdown via portal — renders above everything */}
                                {playbookOpen === env.id && (
                                  <PlaybookDropdown
                                    anchorRef={getDropdownRef(env.id)}
                                    playbooks={playbooks}
                                    selected={currentPlaybook}
                                    onSelect={id => setSelectedPlaybook(prev => ({ ...prev, [env.id]: id }))}
                                    onClose={() => setPlaybookOpen(null)}
                                  />
                                )}
                              </div>
                            )}

                            {/* redeploy */}
                            <button
                              disabled={!!runningAction[env.id]}
                              onClick={() => runAction(env.id, "redeploy")}
                              className="text-xs px-3 py-1.5 rounded-lg border font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-violet-400 border-violet-900/40 hover:bg-violet-950/30"
                            >
                              {runningAction[env.id] ? "..." : "redeploy"}
                            </button>
                          </div>

                          {/* Recent actions log — one per type, latest wins */}
                          {actions[env.id]?.length > 0 && (() => {
                            const latest = Object.values(
                              actions[env.id].reduce((acc, a) => {
                                const key = a.type === "run_script" && a.params
                                  ? JSON.parse(a.params).script ?? a.type
                                  : a.type;
                                if (!acc[key] || a.created_at > acc[key].created_at) acc[key] = a;
                                return acc;
                              }, {} as Record<string, Action>)
                            );
                            return (
                              <div className="mt-3 space-y-1">
                                {latest.map(a => {
                                  const label = a.type === "run_script" && a.params
                                    ? JSON.parse(a.params).script?.split("/").pop()?.replace(".sh","") ?? a.type
                                    : a.type;
                                  return (
                                    <div key={a.id} className="flex items-center gap-3 text-xs font-mono">
                                      <span className={
                                        a.status === "success" ? "text-emerald-400"
                                        : a.status === "failed" ? "text-red-400"
                                        : a.status === "skipped" ? "text-neutral-700"
                                        : "text-amber-400"
                                      }>●</span>
                                      <span className="text-neutral-500">{label}</span>
                                      <span className="text-neutral-700">{timeAgo(a.created_at)}</span>
                                      <span className="text-neutral-700">{a.status}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* UUID */}
                    <p className="text-[10px] font-mono text-neutral-800">{env.id}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Deployments ──────────────────────────────────────────────────────────────

function DeploymentsTab({ deployments, onRefresh }: { deployments: Deployment[]; onRefresh: () => void }) {
  const [selected, setSelected] = useState<string | null>(deployments[0]?.id ?? null);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function fetchEvents(id: string, showLoading = false) {
    if (showLoading) setLoading(true);
    const data = await authFetch<DeploymentEvent[]>(`/api/deployments/${id}/events`);
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

  useEffect(() => {
    if (!selected) return;
    const active = deployments.find(d => d.id === selected);
    const inProgress = active && !["success", "destroyed", "failed_permanent"].includes(active.status);
    if (!inProgress) return;
    const interval = setInterval(() => fetchEvents(selected), 3000);
    return () => clearInterval(interval);
  }, [selected, deployments]);

  async function doDelete(id: string) {
    await authFetch(`/api/deployments/${id}`, { method: "DELETE" });
    setConfirming(null);
    if (selected === id) setSelected(null);
    onRefresh();
  }

  const selectedDeployment = deployments.find(d => d.id === selected);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4">
      {/* Left: list */}
      <div className="space-y-2 md:max-h-[calc(100vh-220px)] md:overflow-y-auto scrollbar-thin pr-1">
        {deployments.length === 0 ? (
          <EmptyState label="no deployments yet" />
        ) : (
          deployments.map(d => (
            <Card
              key={d.id}
              className={`p-4 ${selected === d.id ? "border-neutral-600 bg-neutral-900/60" : ""}`}
              onClick={() => selectDeployment(d.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-200 truncate">{d.environment_name}</p>
                  <p className="text-xs text-neutral-600 font-mono mt-1">{d.provider} · {timeAgo(d.created_at)}</p>
                  {d.retry_count > 0 && (
                    <p className="text-xs text-amber-600 font-mono mt-1">{d.retry_count} retr{d.retry_count === 1 ? "y" : "ies"}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusPill status={d.status} />
                  {confirming === d.id ? (
                    <DeleteConfirm
                      onConfirm={() => doDelete(d.id)}
                      onCancel={() => setConfirming(null)}
                    />
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirming(d.id); }}
                      className="text-[10px] text-neutral-700 hover:text-red-500 font-mono transition-colors"
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Right: events */}
      <Card className="p-5 md:max-h-[calc(100vh-220px)] md:overflow-y-auto scrollbar-thin">
        {!selected || !selectedDeployment ? (
          <EmptyState label="select a deployment" />
        ) : (
          <>
            <div className="mb-5 pb-4 border-b border-neutral-800">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="font-medium text-neutral-100">{selectedDeployment.environment_name}</p>
                <StatusPill status={selectedDeployment.status} />
              </div>
              <p className="text-xs font-mono text-neutral-800 mt-1.5">{selected}</p>
            </div>

            {loading ? (
              <p className="text-xs text-neutral-700 font-mono">loading...</p>
            ) : events.length === 0 ? (
              <EmptyState label="no events" />
            ) : (
              <div className="space-y-0">
                {events.map((ev, i) => {
                  const c = statusColor(ev.type);
                  return (
                    <div key={ev.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${c.text.replace("text-", "bg-")}`} />
                        {i < events.length - 1 && <div className="w-px flex-1 bg-neutral-800/60 mt-1" />}
                      </div>
                      <div className="pb-4 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-sm font-mono text-neutral-300">{ev.type}</p>
                          <p className="text-[11px] text-neutral-700">{new Date(ev.created_at).toLocaleTimeString()}</p>
                        </div>
                        {ev.message && <p className="text-xs text-neutral-600 mt-0.5">{ev.message}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

function NodesTab({ nodes, onRefresh }: { nodes: InfraNode[]; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);

  async function doDelete(id: string) {
    await authFetch(`/api/nodes/${id}`, { method: "DELETE" });
    setConfirming(null);
    onRefresh();
  }

  return (
    <div className="space-y-2">
      {nodes.length === 0 ? (
        <EmptyState
          label="no nodes registered"
          sub="nodes appear after a successful bootstrap"
        />
      ) : (
        nodes.map(node => (
          <Card key={node.id} className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="font-medium text-neutral-100">{node.hostname ?? node.environment_name}</p>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                    node.status === "online"
                      ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/25"
                      : "text-red-400 bg-red-400/10 border-red-400/25"
                  }`}>
                    {node.status === "online" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                    {node.status}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 font-mono">
                  {node.provider}
                  {node.public_ip ? ` · ${node.public_ip}` : ""}
                  {node.agent_version ? ` · v${node.agent_version}` : ""}
                </p>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-xs text-neutral-600 font-mono">last seen {timeAgo(node.last_seen_at)}</p>
                  <p className="text-xs text-neutral-800 font-mono mt-0.5">registered {timeAgo(node.first_seen_at)}</p>
                </div>
                {confirming === node.id ? (
                  <DeleteConfirm
                    onConfirm={() => doDelete(node.id)}
                    onCancel={() => setConfirming(null)}
                  />
                ) : (
                  <button
                    onClick={() => setConfirming(node.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-900/50 text-red-500 hover:bg-red-950/40 transition-colors"
                  >
                    delete
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-neutral-800/50 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-neutral-700 font-mono uppercase tracking-wider mb-1">Node ID</p>
                <p className="text-[11px] font-mono text-neutral-600 break-all">{node.id}</p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-700 font-mono uppercase tracking-wider mb-1">Environment</p>
                <p className="text-[11px] font-mono text-neutral-600 break-all">{node.environment_id}</p>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

// ─── Create ───────────────────────────────────────────────────────────────────

function CreateTab({ templates, onSuccess }: { templates: PlatformTemplate[]; onSuccess: () => void }) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, any>>({});
  const [ttlHours, setTtlHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tmpl = templates.find(t => t.id === selectedTemplate);
  const effectiveTtl = ttlHours ?? tmpl?.default_ttl_hours ?? 72;

  // Reset provider when template changes
  useEffect(() => {
    if (tmpl?.providers[0]) setProvider(tmpl.providers[0]);
  }, [selectedTemplate]);

  const TTL_OPTIONS = [
    { label: "1h", value: 1 },
    { label: "6h", value: 6 },
    { label: "24h", value: 24 },
    { label: "72h", value: 72 },
    { label: "7d", value: 168 },
    { label: "∞", value: 8760 },
  ];

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
        className={`w-full rounded-xl py-3 text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 text-black`}
      >
        {loading ? "creating..." : "create environment"}
      </button>
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (key: string) => void }) {
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

// ─── Keys Tab ─────────────────────────────────────────────────────────────────

function KeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"operator" | "viewer">("operator");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(30);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const ROLE_COLORS: Record<string, string> = {
    admin: "text-red-400 bg-red-400/10 border-red-400/25",
    operator: "text-amber-400 bg-amber-400/10 border-amber-400/25",
    viewer: "text-sky-400 bg-sky-400/10 border-sky-400/25",
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <SectionLabel>API Keys</SectionLabel>

      {/* New key revealed */}
      {newKey && (
        <div className="border border-emerald-900/50 rounded-2xl p-5 bg-emerald-950/20 space-y-3">
          <p className="text-xs text-emerald-400 font-mono uppercase tracking-wider">Key created — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-3">
            <code className="flex-1 text-xs font-mono text-neutral-200 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 break-all">{newKey}</code>
            <button
              onClick={() => copyKey(newKey)}
              className="shrink-0 text-xs px-3 py-3 rounded-lg border border-neutral-700 text-neutral-400 hover:border-neutral-500 transition-colors"
            >
              {copied ? "✓" : "copy"}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-neutral-700 hover:text-neutral-500 font-mono transition-colors">dismiss</button>
        </div>
      )}

      {/* Create form */}
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
                onClick={() => setExpiresInDays(d)}
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

      {/* Keys list */}
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

// ─── Audit Tab ───────────────────────────────────────────────────────────────

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch<AuditEntry[]>("/api/audit?limit=100")
      .then(data => { setEntries(data); setLoading(false); });
  }, []);

  const ACTION_COLORS: Record<string, string> = {
    "environment.create": "text-emerald-400",
    "environment.delete": "text-red-400",
    "key.create": "text-sky-400",
    "key.revoke": "text-amber-400",
  };

  const ROLE_COLORS: Record<string, string> = {
    admin: "text-red-400",
    operator: "text-amber-400",
    viewer: "text-sky-400",
  };

  if (loading) return <EmptyState label="loading..." />;
  if (entries.length === 0) return <EmptyState label="no audit events yet" sub="create or delete environments to generate events" />;

  return (
    <div>
      <Card>
        <div className="divide-y divide-neutral-900">
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-4 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-mono ${ACTION_COLORS[e.action] ?? "text-neutral-400"}`}>
                    {e.action}
                  </span>
                  {e.resource_name && (
                    <span className="text-xs text-neutral-400 font-mono">{e.resource_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className={`text-[11px] font-mono ${ROLE_COLORS[e.actor_role] ?? "text-neutral-600"}`}>
                    {e.actor}
                  </span>
                  <span className="text-[11px] text-neutral-700">{e.actor_role}</span>
                  {e.resource_id && (
                    <span className="text-[11px] font-mono text-neutral-800 hidden sm:block">{e.resource_id}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-neutral-700 font-mono shrink-0">{timeAgo(e.created_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [templates, setTemplates] = useState<PlatformTemplate[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [nodes, setNodes] = useState<InfraNode[]>([]);
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("pinfra_key") ?? "");
  const [userRole, setUserRole] = useState<"admin" | "operator" | "viewer" | null>(null);
  const [authError, setAuthError] = useState(false);

  const loadAll = useCallback(async () => {
    if (!apiKey) return;
    try {
      const [tmpl, envs, deps, nds] = await Promise.all([
        authedFetch<PlatformTemplate[]>("/api/templates", apiKey),
        authedFetch<Environment[]>("/api/environments", apiKey),
        authedFetch<Deployment[]>("/api/deployments", apiKey),
        authedFetch<InfraNode[]>("/api/nodes", apiKey),
      ]);
      setTemplates(tmpl);
      setEnvironments(envs);
      setDeployments(deps);
      setNodes(nds);
      setAuthError(false);
    } catch (e: any) {
      // Only show login screen on auth failure, don't wipe existing data
      if (e?.message === "unauthorized") setAuthError(true);
    }
  }, [apiKey]);

  // Detect role on mount / key change via whoami
  useEffect(() => {
    if (!apiKey) { setUserRole(null); return; }
    authedFetch<{ role: "admin" | "operator" | "viewer"; actor: string }>("/api/whoami", apiKey)
      .then(data => setUserRole(data.role))
      .catch(() => setUserRole(null));
  }, [apiKey]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "environments", label: "Environments" },
    { id: "deployments", label: "Deployments" },
    { id: "nodes", label: "Nodes" },
    { id: "create", label: "Create" },
    ...(userRole === "admin" ? [
      { id: "keys" as Tab, label: "Keys" },
      { id: "audit" as Tab, label: "Audit" },
    ] : []),
  ];

  const activeEnvs = environments.filter(e => e.status === "running").length;
  const activeJobs = deployments.filter(d => d.status === "dispatching").length;
  const downNodes = nodes.filter(n => n.status === "unreachable").length;
  const onlineNodes = nodes.filter(n => n.status === "online").length;

  // Show login if no key
  if (!apiKey || authError) {
    return <LoginScreen onLogin={k => { setApiKey(k); setAuthError(false); }} />;
  }

  return (
    <AuthContext.Provider value={apiKey}>
    <>
      {/* Custom scrollbar styles */}
      <style>{`
        * { scrollbar-width: thin; scrollbar-color: #262626 transparent; }
        *::-webkit-scrollbar { width: 4px; height: 4px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: #262626; border-radius: 99px; }
        *::-webkit-scrollbar-thumb:hover { background: #404040; }
      `}</style>

      <div className="min-h-screen bg-[#080808] text-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-8">

          {/* Header */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-700 font-mono">infrastructure control plane</p>
              <h1 className="text-3xl font-light tracking-tight mt-1.5">
                <span className="text-neutral-100">platform</span>
                <span style={{ color: LIME }}>-infra</span>
              </h1>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {userRole && (
                <span className="text-[11px] font-mono text-neutral-600 border border-neutral-800 rounded px-2 py-1">{userRole}</span>
              )}
              <button
                onClick={() => { localStorage.removeItem("pinfra_key"); setApiKey(""); setUserRole(null); }}
                className="text-[11px] font-mono text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                sign out
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mb-8 border-b border-neutral-900">
            {tabs.map(t => {
              let badge: React.ReactNode = null;
              if (t.id === "environments" && activeEnvs > 0)
                badge = <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${LIME}20`, color: LIME }}>{activeEnvs}</span>;
              if (t.id === "deployments" && activeJobs > 0)
                badge = <span className="ml-1.5 text-[10px] bg-violet-400/15 text-violet-400 rounded-full px-1.5 py-0.5">{activeJobs}</span>;
              if (t.id === "nodes" && downNodes > 0)
                badge = <span className="ml-1.5 text-[10px] bg-red-400/15 text-red-400 rounded-full px-1.5 py-0.5">{downNodes} down</span>;
              if (t.id === "nodes" && downNodes === 0 && onlineNodes > 0)
                badge = <span className="ml-1.5 text-[10px] bg-emerald-400/15 text-emerald-400 rounded-full px-1.5 py-0.5">{onlineNodes}</span>;

              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2.5 text-sm font-mono transition-colors relative -mb-px flex items-center ${
                    tab === t.id ? "text-neutral-100 border-b-2 border-[#CBFF4D]" : "text-neutral-600 hover:text-neutral-400"
                  }`}
                >
                  {t.label}
                  {badge}
                </button>
              );
            })}
          </div>

          {/* Content */}
          {tab === "dashboard" && (
            <DashboardTab environments={environments} deployments={deployments} nodes={nodes} templates={templates} onNavigate={setTab} />
          )}
          {tab === "environments" && (
            <EnvironmentsTab environments={environments} nodes={nodes} onRefresh={loadAll} />
          )}
          {tab === "deployments" && (
            <DeploymentsTab deployments={deployments} onRefresh={loadAll} />
          )}
          {tab === "nodes" && (
            <NodesTab nodes={nodes} onRefresh={loadAll} />
          )}
          {tab === "create" && (userRole === "admin" || userRole === "operator") && (
            <CreateTab templates={templates} onSuccess={() => { loadAll(); setTab("environments"); }} />
          )}
          {tab === "create" && userRole === "viewer" && (
            <EmptyState label="read-only access" sub="you need operator role to create environments" />
          )}
          {tab === "keys" && userRole === "admin" && (
            <KeysTab />
          )}
          {tab === "audit" && userRole === "admin" && (
            <AuditTab />
          )}

        </div>
      </div>
    </>
    </AuthContext.Provider>
  );
}
