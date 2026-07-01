import { useEffect, useCallback, useState } from "react";
import { authedFetch, AuthContext, LIME } from "./api";
import type { Tab, PlatformTemplate, Environment, Deployment, InfraNode } from "./types";
import { LoginScreen }    from "./components/LoginScreen";
import { DashboardTab }   from "./components/DashboardTab";
import { EnvironmentsTab } from "./components/EnvironmentsTab";
import { DeploymentsTab } from "./components/DeploymentsTab";
import { NodesTab }       from "./components/NodesTab";
import { CreateTab }      from "./components/CreateTab";
import { KeysTab }        from "./components/KeysTab";
import { AuditTab }       from "./components/AuditTab";
import { EmptyState }     from "./components/ui";

export default function App() {
  const [tab, setTab]             = useState<Tab>("dashboard");
  const [templates, setTemplates] = useState<PlatformTemplate[]>([]);
  const [environments, setEnvs]   = useState<Environment[]>([]);
  const [deployments, setDeps]    = useState<Deployment[]>([]);
  const [nodes, setNodes]         = useState<InfraNode[]>([]);
  const [apiKey, setApiKey]       = useState<string>(() => localStorage.getItem("pinfra_key") ?? "");
  const [userRole, setUserRole]   = useState<"admin" | "operator" | "viewer" | null>(null);
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
      setEnvs(envs);
      setDeps(deps);
      setNodes(nds);
      setAuthError(false);
    } catch (e: any) {
      if (e?.message === "unauthorized") setAuthError(true);
    }
  }, [apiKey]);

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

  if (!apiKey || authError) {
    return <LoginScreen onLogin={k => { setApiKey(k); setAuthError(false); }} />;
  }

  const activeEnvs  = environments.filter(e => e.status === "running").length;
  const activeJobs  = deployments.filter(d => d.status === "dispatching").length;
  const downNodes   = nodes.filter(n => n.status === "unreachable").length;
  const onlineNodes = nodes.filter(n => n.status === "online").length;

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard",    label: "Dashboard" },
    { id: "environments", label: "Environments" },
    { id: "deployments",  label: "Deployments" },
    { id: "nodes",        label: "Nodes" },
    { id: "create",       label: "Create" },
    ...(userRole === "admin" ? [
      { id: "keys"  as Tab, label: "Keys" },
      { id: "audit" as Tab, label: "Audit" },
    ] : []),
  ];

  return (
    <AuthContext.Provider value={apiKey}>
      <>
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
                <p className="text-[11px] uppercase tracking-[0.3em] text-neutral-700 font-mono">
                  infrastructure control plane
                </p>
                <h1 className="text-3xl font-light tracking-tight mt-1.5">
                  <span className="text-neutral-100">platform</span>
                  <span style={{ color: LIME }}>-infra</span>
                </h1>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {userRole && (
                  <span className="text-[11px] font-mono text-neutral-600 border border-neutral-800 rounded px-2 py-1">
                    {userRole}
                  </span>
                )}
                <button
                  onClick={() => {
                    localStorage.removeItem("pinfra_key");
                    setApiKey("");
                    setUserRole(null);
                  }}
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
                      tab === t.id
                        ? "text-neutral-100 border-b-2 border-[#CBFF4D]"
                        : "text-neutral-600 hover:text-neutral-400"
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
              <DashboardTab
                environments={environments}
                deployments={deployments}
                nodes={nodes}
                templates={templates}
                onNavigate={setTab}
              />
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
            {tab === "keys"  && userRole === "admin" && <KeysTab />}
            {tab === "audit" && userRole === "admin" && <AuditTab />}

          </div>
        </div>
      </>
    </AuthContext.Provider>
  );
}
