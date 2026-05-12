import { useEffect, useState } from "react";

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
  created_at: string;
};

type DeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

//const API = "https://platform-control-plane.casablanque.workers.dev";
const API = window.location.origin;

export default function App() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);

  const [selectedDeployment, setSelectedDeployment] =
    useState<string | null>(null);
    useEffect(() => {
      if (
        deployments.length > 0 &&
        !selectedDeployment
      ) {
        const latest = deployments[0];
    
        setSelectedDeployment(latest.id);
    
        loadEvents(latest.id);
      }
    }, [deployments]);

  const [form, setForm] = useState({
    name: "",
    provider: "hetzner",
    region: "fsn1",
    template: "docker-host",
    ttl_hours: 72,
  });

  async function loadEnvironments() {
    const res = await fetch(`${API}/api/environments`);
    const data = await res.json();

    setEnvironments(data);
  }

  async function loadDeployments() {
    const res = await fetch(`${API}/api/deployments`);
    const data = await res.json();

    setDeployments(data);
  }

  async function loadEvents(deploymentId: string) {
    const res = await fetch(
      `${API}/api/deployments/${deploymentId}/events`
    );

    const data = await res.json();

    setEvents(data);
  }

  async function createEnvironment(
    e: React.FormEvent
  ) {
    e.preventDefault();

    await fetch(`${API}/api/environments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(form),
    });

    setForm({
      name: "",
      provider: "hetzner",
      region: "fsn1",
      template: "docker-host",
      ttl_hours: 72,
    });

    loadEnvironments();
    loadDeployments();
  }

  useEffect(() => {
    loadEnvironments();
    loadDeployments();

    const interval = setInterval(() => {
      loadEnvironments();
      loadDeployments();

      if (selectedDeployment) {
        loadEvents(selectedDeployment);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedDeployment]);

  return (
    <div className="min-h-screen bg-black text-neutral-200">
      <div className="max-w-[1800px] mx-auto p-8">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
            edge-native infrastructure control plane
          </p>

          <h1 className="text-5xl font-bold mt-3">
            platform-infra
          </h1>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr_420px] gap-8">

          {/* CREATE ENV */}

          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950 h-fit">
            <h2 className="text-xl font-semibold mb-6">
              Create Environment
            </h2>

            <form
              onSubmit={createEnvironment}
              className="space-y-4"
            >
              <div>
                <label className="text-sm text-neutral-400">
                  Name
                </label>

                <input
                  className="w-full mt-1 bg-black border border-neutral-700 rounded-lg px-3 py-2"
                  value={form.name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value,
                    })
                  }
                  required
                />
              </div>

              <div>
                <label className="text-sm text-neutral-400">
                  Provider
                </label>

                <select
                  className="w-full mt-1 bg-black border border-neutral-700 rounded-lg px-3 py-2"
                  value={form.provider}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      provider: e.target.value,
                    })
                  }
                >
                  <option>hetzner</option>
                  <option>oracle</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-neutral-400">
                  Region
                </label>

                <input
                  className="w-full mt-1 bg-black border border-neutral-700 rounded-lg px-3 py-2"
                  value={form.region}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      region: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="text-sm text-neutral-400">
                  Template
                </label>

                <input
                  className="w-full mt-1 bg-black border border-neutral-700 rounded-lg px-3 py-2"
                  value={form.template}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      template: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="text-sm text-neutral-400">
                  TTL Hours
                </label>

                <input
                  type="number"
                  className="w-full mt-1 bg-black border border-neutral-700 rounded-lg px-3 py-2"
                  value={form.ttl_hours}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      ttl_hours: Number(e.target.value),
                    })
                  }
                />
              </div>

              <button
                className="w-full bg-white text-black rounded-lg py-3 font-medium mt-4 hover:opacity-90 transition"
              >
                Create Environment
              </button>
            </form>
          </div>

          {/* ENVIRONMENTS + DEPLOYMENTS */}

          <div className="space-y-8">

            {/* ENVIRONMENTS */}

            <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  Environments
                </h2>

                <button
                  onClick={loadEnvironments}
                  className="text-sm text-neutral-400 hover:text-white"
                >
                  refresh
                </button>
              </div>

              <div className="space-y-4">
                {environments.map((env) => (
                  <div
                    key={env.id}
                    className="border border-neutral-800 rounded-xl p-4 bg-black"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-lg">
                          {env.name}
                        </div>

                        <div className="text-sm text-neutral-500 mt-1">
                          {env.provider} · {env.region}
                        </div>
                      </div>

                      <div className="text-sm px-3 py-1 rounded-full border border-neutral-700">
                        {env.status}
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-neutral-400">
                      template: {env.template}
                    </div>

                    <div className="mt-1 text-sm text-neutral-400">
                      ttl: {env.ttl_hours}h
                    </div>
                  </div>
                ))}

                {environments.length === 0 && (
                  <div className="text-neutral-500">
                    no environments yet
                  </div>
                )}
              </div>
            </div>

            {/* DEPLOYMENTS */}

            <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  Deployments
                </h2>

                <button
                  onClick={loadDeployments}
                  className="text-sm text-neutral-400 hover:text-white"
                >
                  refresh
                </button>
              </div>

              <div className="space-y-4">
                {deployments.map((dep) => (
                  <button
                    key={dep.id}
                    onClick={() => {
                      setSelectedDeployment(dep.id);
                      loadEvents(dep.id);
                    }}
                    className={`w-full text-left border rounded-xl p-4 transition ${
                      selectedDeployment === dep.id
                        ? "border-white bg-neutral-900"
                        : "border-neutral-800 bg-black hover:border-neutral-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">
                          {dep.environment_name}
                        </div>

                        <div className="text-sm text-neutral-500 mt-1">
                          {dep.provider}
                        </div>
                      </div>

                      <div className="text-sm px-3 py-1 rounded-full border border-neutral-700">
                        {dep.status}
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-neutral-600 break-all">
                      {dep.id}
                    </div>
                  </button>
                ))}

                {deployments.length === 0 && (
                  <div className="text-neutral-500">
                    no deployments yet
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TIMELINE */}

          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950 h-fit sticky top-8">
            <h2 className="text-xl font-semibold mb-6">
              Deployment Timeline
            </h2>

            {!selectedDeployment && (
              <div className="text-neutral-500">
                select deployment
              </div>
            )}

            {selectedDeployment && (
              <div className="space-y-4">
                <div className="text-xs text-neutral-600 break-all">
                  {selectedDeployment}
                </div>

                {events.map((event) => (
                  <div
                    key={event.id}
                    className="border border-neutral-800 rounded-xl p-4 bg-black"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {event.type}
                      </div>

                      <div className="text-xs text-neutral-600">
                        {new Date(
                          event.created_at
                        ).toLocaleTimeString()}
                      </div>
                    </div>

                    <div className="mt-2 text-sm text-neutral-400">
                      {event.message}
                    </div>
                  </div>
                ))}

                {events.length === 0 && (
                  <div className="text-neutral-500">
                    no events
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}