import type { Environment, Deployment, InfraNode, PlatformTemplate, Tab } from "../types";
import { Card, SectionLabel, EmptyState, StatusPill, timeAgo } from "./ui";

export function DashboardTab({
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
            { label: "Active",   value: envStats.active,   color: "text-emerald-400" },
            { label: "Queued",   value: envStats.queued,   color: "text-sky-400"     },
            { label: "Failed",   value: envStats.failed,   color: "text-red-400"     },
            { label: "Expiring", value: envStats.expiring, color: "text-amber-400"   },
          ].map(s => (
            <Card key={s.label} className="p-5" onClick={() => onNavigate("environments")}>
              <p className="text-[11px] uppercase tracking-wider text-neutral-600 font-mono mb-3">{s.label}</p>
              <p className={`text-4xl font-light tabular-nums ${s.color}`}>{s.value}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Deployments + Nodes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionLabel>Deployments</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "In progress", value: deployStats.running, color: "text-violet-400" },
              { label: "Failed",      value: deployStats.failed,  color: "text-red-400"    },
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
              { label: "Online",      value: nodeStats.online,      color: "text-emerald-400" },
              { label: "Unreachable", value: nodeStats.unreachable, color: "text-red-400"     },
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
            const total   = environments.filter(e => e.provider === p).length;
            const lost    = nodes.filter(n => n.provider === p && n.status === "unreachable").length;
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

      {/* Recent activity */}
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
