import { useState } from "react";
import type { InfraNode } from "../types";
import { useAuthFetch } from "../api";
import { Card, EmptyState, DeleteConfirm, timeAgo } from "./ui";

export function NodesTab({ nodes, onRefresh }: { nodes: InfraNode[]; onRefresh: () => void }) {
  const authFetch = useAuthFetch();
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
