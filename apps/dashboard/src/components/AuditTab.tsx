import { useEffect, useState } from "react";
import type { AuditEntry } from "../types";
import { useAuthFetch } from "../api";
import { Card, EmptyState, timeAgo } from "./ui";

const ACTION_COLORS: Record<string, string> = {
  "environment.create": "text-emerald-400",
  "environment.delete": "text-red-400",
  "key.create":         "text-sky-400",
  "key.revoke":         "text-amber-400",
};

const ROLE_COLORS: Record<string, string> = {
  admin:    "text-red-400",
  operator: "text-amber-400",
  viewer:   "text-sky-400",
};

export function AuditTab() {
  const authFetch = useAuthFetch();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch<AuditEntry[]>("/api/audit?limit=100")
      .then(data => { setEntries(data); setLoading(false); });
  }, []);

  if (loading) return <EmptyState label="loading..." />;
  if (entries.length === 0) return (
    <EmptyState
      label="no audit events yet"
      sub="create or delete environments to generate events"
    />
  );

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
