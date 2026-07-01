import { useRef, useState } from "react";
import type { Environment, InfraNode, EnvironmentOutput, Action } from "../types";
import { useAuthFetch } from "../api";
import { Card, EmptyState, StatusPill, DeleteConfirm, PlaybookDropdown, ttlInfo, timeAgo } from "./ui";

const PLAYBOOKS: Record<string, { id: string; label: string; desc: string }[]> = {
  "docker-host": [
    { id: "install_portainer",     label: "Install Portainer",     desc: "Web UI for Docker management"   },
    { id: "install_node_exporter", label: "Install Node Exporter", desc: "Prometheus metrics endpoint"    },
    { id: "install_uptime_kuma",   label: "Install Uptime Kuma",   desc: "Self-hosted uptime monitoring"  },
  ],
  "postgres": [
    { id: "install_pgadmin", label: "Install pgAdmin", desc: "Web UI for PostgreSQL"          },
    { id: "backup_to_r2",    label: "Backup to R2",    desc: "Dump database to Cloudflare R2" },
  ],
};

export function EnvironmentsTab({ environments, nodes, onRefresh }: {
  environments: Environment[];
  nodes: InfraNode[];
  onRefresh: () => void;
}) {
  const authFetch = useAuthFetch();
  const [filter, setFilter]                   = useState("all");
  const [search, setSearch]                   = useState("");
  const [expanded, setExpanded]               = useState<string | null>(null);
  const [outputs, setOutputs]                 = useState<Record<string, EnvironmentOutput[]>>({});
  const [confirming, setConfirming]           = useState<{ id: string; action: "destroy" | "delete" } | null>(null);
  const [actions, setActions]                 = useState<Record<string, Action[]>>({});
  const [runningAction, setRunningAction]     = useState<Record<string, boolean>>({});
  const [playbookOpen, setPlaybookOpen]       = useState<string | null>(null);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Record<string, string>>({});
  const dropdownRefs = useRef<Record<string, React.RefObject<HTMLButtonElement | null>>>({});

  function getDropdownRef(envId: string) {
    if (!dropdownRefs.current[envId]) dropdownRefs.current[envId] = { current: null };
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
    if (next) { loadOutputs(next); loadActions(next); }
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
            const node        = nodes.find(n => n.environment_id === env.id);
            const ttl         = ttlInfo(env.created_at, env.ttl_hours);
            const isExpanded  = expanded === env.id;
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
                    {env.status === "running" && ttl.label !== "no auto-destroy" && (
                      <span className={`text-xs font-mono hidden sm:block ${ttl.urgent ? "text-amber-400" : "text-neutral-600"}`}>
                        {ttl.label}
                      </span>
                    )}

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

                {/* Expanded panel */}
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
                        {node.hostname  && <span className="text-neutral-500">{node.hostname}</span>}
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
                      const playbooks      = PLAYBOOKS[env.template] ?? [];
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

                            {/* playbook runner */}
                            {playbooks.length > 0 && (
                              <div className="relative">
                                <div className="flex rounded-lg border border-sky-900/40 overflow-hidden">
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
                                  <div className="w-px bg-sky-900/40" />
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

                          {/* Recent actions log */}
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
                                    ? JSON.parse(a.params).script?.split("/").pop()?.replace(".sh", "") ?? a.type
                                    : a.type;
                                  return (
                                    <div key={a.id} className="flex items-center gap-3 text-xs font-mono">
                                      <span className={
                                        a.status === "success" ? "text-emerald-400"
                                        : a.status === "failed"  ? "text-red-400"
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
