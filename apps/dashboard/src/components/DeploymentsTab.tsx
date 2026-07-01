import { useEffect, useState } from "react";
import type { Deployment, DeploymentEvent } from "../types";
import { useAuthFetch } from "../api";
import { Card, EmptyState, StatusPill, DeleteConfirm, statusColor, timeAgo } from "./ui";

export function DeploymentsTab({ deployments, onRefresh }: {
  deployments: Deployment[];
  onRefresh: () => void;
}) {
  const authFetch = useAuthFetch();
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
