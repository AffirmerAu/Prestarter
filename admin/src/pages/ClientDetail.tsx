import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiPost, assetUrl } from "../lib/api";

// Admin export endpoints require the Authorization header, so a plain <a href> would just
// 401 — fetch with auth, open the resulting blob URL instead. The tab must be opened
// synchronously inside the click handler (before the `await`) — opening it only after the
// fetch resolves breaks the browser's user-gesture chain and gets silently popup-blocked
// (confirmed: the fetch succeeded but no tab appeared until this was fixed).
async function openAsset(path: string) {
  const tab = window.open("", "_blank");
  const url = await assetUrl(path);
  if (tab) tab.location.href = url;
}

interface ClientDetailData {
  client: {
    id: string;
    name: string;
    mark_as: string;
    status: string;
    plan_tier: string;
    term_start: string;
    term_end: string;
    billing_state: string;
    paid_to: string;
    grace_days: number;
    daily_cap_advisory: number;
  };
  contacts: { id: string; email: string; name: string; role: string | null }[];
  keys: { id: string; key: string; issued_at: string; revoked_at: string | null }[];
  entitlements: {
    id: string;
    video_id: string;
    effective_from: string;
    effective_to: string | null;
    videos: { id: string; title: string; display_code: string };
  }[];
  billingEvents: { id: string; action: string; actor: string; occurred_at: string; reference: string | null }[];
}

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClientDetailData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await apiGet<ClientDetailData>(`/internal/clients/${id}`);
    setData(d);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function markPaid() {
    setBusy(true);
    await apiPost(`/internal/clients/${id}/mark-paid`, {});
    await load();
    setBusy(false);
  }

  async function togglePause() {
    setBusy(true);
    const action = data?.client.status === "active" ? "pause" : "restore";
    await apiPost(`/internal/clients/${id}/${action}`, {});
    await load();
    setBusy(false);
  }

  async function rotateKey(keyId: string) {
    if (!confirm("Rotating this key breaks every existing link and printed poster for this client. Continue?")) return;
    setBusy(true);
    await apiPost(`/internal/access-keys/${keyId}/rotate`, {});
    await load();
    setBusy(false);
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const { client } = data;
  const activeKey = data.keys.find((k) => !k.revoked_at);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{client.name}</h1>
          <p className="text-sm text-gray-500">Watermark text: {client.mark_as}</p>
        </div>
        <button
          onClick={togglePause}
          disabled={busy}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {client.status === "active" ? "Pause client" : "Restore client"}
        </button>
      </div>

      <section className="grid grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Billing</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">State</dt>
              <dd className="font-medium">{client.billing_state}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Paid to</dt>
              <dd>{client.paid_to}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Grace days</dt>
              <dd>{client.grace_days}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Term</dt>
              <dd>
                {client.term_start} → {client.term_end}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Advisory cap</dt>
              <dd>{client.daily_cap_advisory}/day</dd>
            </div>
          </dl>
          <button
            onClick={markPaid}
            disabled={busy}
            className="mt-3 w-full rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Mark paid
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Contacts</h2>
          <ul className="space-y-1 text-sm">
            {data.contacts.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{c.name}</span>
                <span className="text-gray-500">{c.email}</span>
              </li>
            ))}
            {data.contacts.length === 0 && <li className="text-gray-500">No contacts yet.</li>}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Access key</h2>
        {activeKey ? (
          <div className="flex items-center justify-between">
            <code className="rounded bg-gray-100 px-2 py-1 text-xs">{activeKey.key}</code>
            <button
              onClick={() => rotateKey(activeKey.id)}
              disabled={busy}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Rotate key
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active key.</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Entitlements &amp; links</h2>
        <ul className="divide-y divide-gray-100">
          {data.entitlements.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium text-gray-900">{e.videos.title}</div>
                <div className="text-gray-500">{e.videos.display_code}</div>
              </div>
              {activeKey && (
                <div className="flex gap-3">
                  <button
                    className="text-gray-500 hover:underline"
                    onClick={() => openAsset(`/internal/clients/${client.id}/videos/${e.video_id}/qr.svg`)}
                  >
                    QR (SVG)
                  </button>
                  <button
                    className="text-gray-500 hover:underline"
                    onClick={() => openAsset(`/internal/clients/${client.id}/videos/${e.video_id}/qr.png`)}
                  >
                    QR (PNG)
                  </button>
                </div>
              )}
            </li>
          ))}
          {data.entitlements.length === 0 && <li className="py-2 text-sm text-gray-500">No entitlements yet.</li>}
        </ul>
        {activeKey && (
          <button
            onClick={() => openAsset(`/internal/clients/${client.id}/poster.png`)}
            className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Export poster (PNG)
          </button>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Billing history</h2>
        <ul className="divide-y divide-gray-100 text-sm">
          {data.billingEvents.map((b) => (
            <li key={b.id} className="flex justify-between py-1.5">
              <span>{b.action.replace(/_/g, " ")}</span>
              <span className="text-gray-500">
                {b.actor} · {new Date(b.occurred_at).toLocaleString("en-AU")}
              </span>
            </li>
          ))}
          {data.billingEvents.length === 0 && <li className="py-1.5 text-gray-500">No billing events yet.</li>}
        </ul>
      </section>
    </div>
  );
}
