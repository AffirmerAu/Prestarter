import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";

interface DashboardData {
  playsToday: number;
  activeClients: number;
  videosReleased: number;
  openAlerts: number;
  accountsOverdue: { id: string; name: string; paid_to: string }[];
  playsByDay: { day: string; plays: number }[];
}

interface Alert {
  id: string;
  type: string;
  severity: "warning" | "critical";
  evidence: Record<string, unknown>;
  raised_at: string;
  clients: { id: string; name: string } | null;
}

const ALERT_COPY: Record<string, (evidence: Record<string, unknown>) => string> = {
  advisory_cap_exceeded: (e) => `${e.plays} plays today against an advisory cap of ${e.daily_cap_advisory} — worth a look, not a block.`,
  geographic_spread: () => `Plays are coming from several countries in one day — check for a shared link.`,
  approaching_cap: (e) => `Nearing the advisory cap (${e.plays}/${e.daily_cap_advisory}).`,
  payment_overdue: () => `This account has moved to overdue — playback is now blocked.`,
  cutoff_imminent: () => `Cutoff is three days away unless payment is confirmed.`,
};

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  async function load() {
    const [dashboardData, alertData] = await Promise.all([
      apiGet<DashboardData>("/internal/dashboard"),
      apiGet<Alert[]>("/internal/alerts"),
    ]);
    setData(dashboardData);
    setAlerts(alertData);
  }

  useEffect(() => {
    load();
  }, []);

  async function acknowledge(id: string) {
    await apiPost(`/internal/alerts/${id}/acknowledge`, {});
    load();
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const maxPlays = Math.max(1, ...data.playsByDay.map((d) => d.plays));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Metric label="Plays today" value={data.playsToday} />
        <Metric label="Active clients" value={data.activeClients} />
        <Metric label="Videos released" value={data.videosReleased} />
        <Metric label="Open alerts" value={data.openAlerts} />
        <Metric label="Accounts overdue" value={data.accountsOverdue.length} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Plays, last 7 days</h2>
        <div className="flex items-end gap-2 rounded-lg border border-gray-200 bg-white p-4" style={{ height: 140 }}>
          {data.playsByDay.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-gray-900"
                style={{ height: `${(d.plays / maxPlays) * 90}px` }}
                title={`${d.plays} plays`}
              />
              <span className="text-[10px] text-gray-400">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-500">No open alerts.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`flex items-start justify-between rounded-lg border p-3 ${
                  a.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {a.clients?.name ?? "Unknown client"} — {a.type.replace(/_/g, " ")}
                  </div>
                  <div className="text-sm text-gray-600">
                    {(ALERT_COPY[a.type]?.(a.evidence) ?? JSON.stringify(a.evidence))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {a.clients && (
                    <Link to={`/clients/${a.clients.id}`} className="text-sm text-gray-500 hover:underline">
                      Open client
                    </Link>
                  )}
                  <button onClick={() => acknowledge(a.id)} className="text-sm text-gray-500 hover:underline">
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Overdue accounts</h2>
        {data.accountsOverdue.length === 0 ? (
          <p className="text-sm text-gray-500">None.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {data.accountsOverdue.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link to={`/clients/${c.id}`} className="text-gray-900 hover:underline">
                  {c.name}
                </Link>
                <span className="text-gray-500">paid to {c.paid_to}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
