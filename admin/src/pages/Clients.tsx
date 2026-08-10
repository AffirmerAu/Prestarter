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

function Badge({ tone, children }: { tone: "success" | "warning" | "error" | "neutral"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    success: "bg-primary-tint text-primary-press border-primary-tint-border",
    warning: "bg-[#FFFAEB] text-[#93370D] border-[#FEDF89]",
    error: "bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]",
    neutral: "bg-surface-muted text-[#475467] border-line",
  };
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[tone]}`}>
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === "active" ? "success" : "neutral"}>{status}</Badge>;
}

function BillingBadge({ state }: { state: string }) {
  const tone = state === "paid" ? "success" : state === "due" ? "warning" : "error";
  return <Badge tone={tone}>{state}</Badge>;
}

export function Clients() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);

  useEffect(() => {
    apiGet<ClientRow[]>("/internal/clients").then(setClients);
  }, []);

  if (!clients) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-h1 font-bold text-ink">Clients</h1>
        <Link
          to="/clients/new"
          className="rounded-input bg-primary px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press"
        >
          New client
        </Link>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken text-left text-muted">
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Name</th>
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Plays today / cap</th>
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Term end</th>
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Billing</th>
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Alerts</th>
              <th className="px-4 py-2.5 text-label uppercase font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F2F4F7]">
            {clients.map((c) => (
              <tr key={c.id} className="h-11 hover:bg-surface-sunken">
                <td className="px-4 py-2">
                  <Link to={`/clients/${c.id}`} className="font-medium text-ink hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-body">
                  {c.plays_today} / {c.daily_cap_advisory}
                </td>
                <td className="px-4 py-2 text-body">{c.term_end}</td>
                <td className="px-4 py-2">
                  <BillingBadge state={c.billing_state} />
                </td>
                <td className="px-4 py-2 text-body">{c.open_alert_count > 0 ? c.open_alert_count : "—"}</td>
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
