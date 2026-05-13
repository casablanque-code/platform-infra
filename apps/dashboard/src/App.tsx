import { useEffect, useState } from "react";

const API = window.location.origin;

type Environment = {
  id: string;
  name: string;
  provider: string;
  region: string;
  template: string;
  status: string;
  ttl_hours: number;
};

type Deployment = {
  id: string;
  environment_name: string;
  provider: string;
  status: string;
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
  created_at: string;
};

type PlatformTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  providers: string[];
  default_region: string;
  default_ttl_hours: number;
};

export default function App() {
  const [templates, setTemplates] = useState<PlatformTemplate[]>([]);

  const [environments, setEnvironments] = useState<Environment[]>([]);

  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const [events, setEvents] = useState<DeploymentEvent[]>([]);

  const [, setOutputs] = useState<EnvironmentOutput[]>([]);

  const [selectedDeployment, setSelectedDeployment] =
    useState<string | null>(null);

  const [name, setName] = useState("");

  const [provider, setProvider] = useState("oracle");

  const [template, setTemplate] = useState("docker-host");

  async function loadTemplates() {
    const response = await fetch(`${API}/api/templates`);
    const data = await response.json();

    setTemplates(data);
  }

  async function loadEnvironments() {
    const response = await fetch(`${API}/api/environments`);
    const data = await response.json();

    setEnvironments(data);
  }

  async function loadDeployments() {
    const response = await fetch(`${API}/api/deployments`);
    const data = await response.json();

    setDeployments(data);
  }

  async function loadEvents(id: string) {
    const response = await fetch(
      `${API}/api/deployments/${id}/events`
    );

    const data = await response.json();

    setEvents(data);
  }

  async function loadOutputs(environmentId: string) {
    const response = await fetch(
      `${API}/api/environments/${environmentId}/outputs`
    );
  
    const data = await response.json();
  
    setOutputs(data);
  }

  async function createEnvironment() {
    const selectedTemplate =
      templates.find((t) => t.id === template);

    if (!selectedTemplate) {
      return;
    }

    await fetch(`${API}/api/environments`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        name,
        provider,
        region: selectedTemplate.default_region,
        template,
        ttl_hours: selectedTemplate.default_ttl_hours,
      }),
    });

    setName("");

    loadEnvironments();
    loadDeployments();
  }

  async function deleteEnvironment(id: string) {
    await fetch(`${API}/api/environments/${id}`, {
      method: "DELETE",
    });
  
    loadEnvironments();
    loadDeployments();
  
    setEvents([]);
    setOutputs([]);
  }

  useEffect(() => {
    loadTemplates();
    loadEnvironments();
    loadDeployments();
  }, []);

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

  useEffect(() => {
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

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr_420px] gap-8">

          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950 h-fit">

            <h2 className="text-xl font-semibold mb-6">
              Create Environment
            </h2>

            <div className="space-y-4">

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="environment name"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3"
              />

              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3"
              >
                <option value="oracle">oracle</option>
                <option value="hetzner">hetzner</option>
              </select>

              <div className="space-y-3">

                {templates.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTemplate(item.id)}
                    className={`w-full text-left border rounded-2xl p-4 transition ${
                      template === item.id
                        ? "border-white bg-neutral-900"
                        : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {item.name}
                      </h3>

                      <span className="text-xs uppercase text-neutral-500">
                        {item.category}
                      </span>
                    </div>

                    <p className="text-sm text-neutral-400 mt-2">
                      {item.description}
                    </p>

                    <div className="flex gap-2 mt-4 flex-wrap">
                      {item.providers.map((provider) => (
                        <span
                          key={provider}
                          className="text-xs border border-neutral-700 rounded-full px-2 py-1 text-neutral-400"
                        >
                          {provider}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}

              </div>

              <button
                onClick={createEnvironment}
                className="w-full bg-white text-black rounded-xl py-3 font-semibold hover:bg-neutral-200 transition"
              >
                create environment
              </button>

            </div>
          </div>

          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950">

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">
                Environments
              </h2>
            </div>

            <div className="space-y-4">

              {environments.map((env) => (
                <div
                  key={env.id}
                  className="border border-neutral-800 rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {env.name}
                      </h3>

                      <p className="text-sm text-neutral-500 mt-1">
                        {env.provider} · {env.region}
                      </p>
                    </div>

                    <span className="text-xs uppercase border border-neutral-700 rounded-full px-3 py-1">
                      {env.status}
                    </span>
                  </div>

                  <div className="mt-4 flex gap-3 text-sm text-neutral-400">
                    <span>
                      template: {env.template}
                    </span>

                    <span>
                      ttl: {env.ttl_hours}h
                    </span>
                  </div>
                  <div className="mt-4">
  <button
    onClick={() => deleteEnvironment(env.id)}
    className="text-xs border border-red-900 text-red-400 rounded-lg px-3 py-2 hover:bg-red-950 transition"
  >
    delete
  </button>
</div>
                </div>
              ))}

            </div>
          </div>

          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-950">

            <h2 className="text-xl font-semibold mb-6">
              Deployment Timeline
            </h2>

            <div className="space-y-4">

              {deployments.map((deployment) => (
                <button
                  key={deployment.id}
                  onClick={async () => {
                    setSelectedDeployment(deployment.id);
                  
                    loadEvents(deployment.id);
                  
                    const env = environments.find(
                      (e) => e.name === deployment.environment_name
                    );
                  
                    if (env) {
                      loadOutputs(env.id);
                    }
                  }}
                  className={`w-full text-left border rounded-2xl p-4 transition ${
                    selectedDeployment === deployment.id
                      ? "border-white bg-neutral-900"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">
                        {deployment.environment_name}
                      </h3>

                      <p className="text-xs text-neutral-500 mt-1 break-all">
                        {deployment.id}
                      </p>
                    </div>

                    <span className="text-xs uppercase border border-neutral-700 rounded-full px-2 py-1">
                      {deployment.status}
                    </span>
                  </div>
                </button>
              ))}

            </div>

            {selectedDeployment && (
              <div className="mt-8 border-t border-neutral-800 pt-6">

                <div className="space-y-4">

                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="border-l border-neutral-700 pl-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">
                          {event.type}
                        </p>

                        <p className="text-xs text-neutral-500">
                          {new Date(
                            event.created_at
                          ).toLocaleTimeString()}
                        </p>
                      </div>

                      <p className="text-sm text-neutral-400 mt-1">
                        {event.message}
                      </p>
                    </div>
                  ))}

                </div>
              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}