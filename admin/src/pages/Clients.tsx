import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api";

interface ClientRow {
  id: string;
  name: string;
  status: string;
  term_end: string;
  billing_state: string;
  daily_cap_advisory: number;
  plays_today: number;
  open_alert_count: number;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    paused: "bg-gray-200 text-gray-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? ""}`}>{status}</span>;
}

function BillingBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    paid: "bg-green-100 text-green-800",
    due: "bg-amber-100 text-amber-800",
    overdue: "bg-red-100 text-red-800",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[state] ?? ""}`}>{state}</span>;
}

export function Clients() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);

  useEffect(() => {
    apiGet<ClientRow[]>("/internal/clients").then(setClients);
  }, []);

  if (!clients) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Clients</h1>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Plays today / cap</th>
              <th className="px-4 py-2 font-medium">Term end</th>
              <th className="px-4 py-2 font-medium">Billing</th>
              <th className="px-4 py-2 font-medium">Alerts</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link to={`/clients/${c.id}`} className="font-medium text-gray-900 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {c.plays_today} / {c.daily_cap_advisory}
                </td>
                <td className="px-4 py-2 text-gray-600">{c.term_end}</td>
                <td className="px-4 py-2">
                  <BillingBadge state={c.billing_state} />
                </td>
                <td className="px-4 py-2 text-gray-600">{c.open_alert_count > 0 ? c.open_alert_count : "—"}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
