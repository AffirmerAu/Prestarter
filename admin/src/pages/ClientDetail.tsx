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

const cardClass = "rounded-card border border-line bg-surface p-5";
const cardHeaderClass = "mb-3 border-b border-line pb-3 text-h3 font-semibold text-ink";
const secondaryBtnClass =
  "rounded-input border border-line-strong px-3 py-1.5 text-sm text-body hover:bg-surface-sunken disabled:opacity-50";
const primaryBtnClass =
  "rounded-input bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:opacity-50";
const destructiveBtnClass =
  "rounded-input border border-[#FECDCA] px-3 py-1.5 text-sm text-[#B42318] hover:bg-[#FEF3F2] disabled:opacity-50";

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

  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { client } = data;
  const activeKey = data.keys.find((k) => !k.revoked_at);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 font-bold text-ink">{client.name}</h1>
          <p className="text-sm text-muted">Watermark text: {client.mark_as}</p>
        </div>
        <button onClick={togglePause} disabled={busy} className={secondaryBtnClass}>
          {client.status === "active" ? "Pause client" : "Restore client"}
        </button>
      </div>

      <section className="grid grid-cols-2 gap-6">
        <div className={cardClass}>
          <h2 className={cardHeaderClass}>Billing</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">State</dt>
              <dd className="font-medium text-ink">{client.billing_state}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Paid to</dt>
              <dd className="text-body">{client.paid_to}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Grace days</dt>
              <dd className="text-body">{client.grace_days}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Term</dt>
              <dd className="text-body">
                {client.term_start} → {client.term_end}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Advisory cap</dt>
              <dd className="text-body">{client.daily_cap_advisory}/day</dd>
            </div>
          </dl>
          <button onClick={markPaid} disabled={busy} className={`mt-3 w-full ${primaryBtnClass}`}>
            Mark paid
          </button>
        </div>

        <div className={cardClass}>
          <h2 className={cardHeaderClass}>Contacts</h2>
          <ul className="space-y-1 text-sm">
            {data.contacts.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span className="text-ink">{c.name}</span>
                <span className="text-muted">{c.email}</span>
              </li>
            ))}
            {data.contacts.length === 0 && <li className="text-muted">No contacts yet.</li>}
          </ul>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Access key</h2>
        {activeKey ? (
          <div className="flex items-center justify-between">
            <code className="rounded-md bg-surface-muted px-2 py-1 text-code font-mono text-body">{activeKey.key}</code>
            <button onClick={() => rotateKey(activeKey.id)} disabled={busy} className={destructiveBtnClass}>
              Rotate key
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">No active key.</p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Entitlements &amp; links</h2>
        <ul className="divide-y divide-[#F2F4F7]">
          {data.entitlements.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium text-ink">{e.videos.title}</div>
                <div className="text-muted">{e.videos.display_code}</div>
              </div>
              {activeKey && (
                <div className="flex gap-3">
                  <button
                    className="text-muted hover:underline"
                    onClick={() => openAsset(`/internal/clients/${client.id}/videos/${e.video_id}/qr.svg`)}
                  >
                    QR (SVG)
                  </button>
                  <button
                    className="text-muted hover:underline"
                    onClick={() => openAsset(`/internal/clients/${client.id}/videos/${e.video_id}/qr.png`)}
                  >
                    QR (PNG)
                  </button>
                </div>
              )}
            </li>
          ))}
          {data.entitlements.length === 0 && <li className="py-2 text-sm text-muted">No entitlements yet.</li>}
        </ul>
        {activeKey && (
          <button onClick={() => openAsset(`/internal/clients/${client.id}/poster.png`)} className={`mt-3 ${secondaryBtnClass}`}>
            Export poster (PNG)
          </button>
        )}
      </section>

      <section className={cardClass}>
        <h2 className={cardHeaderClass}>Billing history</h2>
        <ul className="divide-y divide-[#F2F4F7] text-sm">
          {data.billingEvents.map((b) => (
            <li key={b.id} className="flex justify-between py-1.5">
              <span className="text-ink">{b.action.replace(/_/g, " ")}</span>
              <span className="text-muted">
                {b.actor} · {new Date(b.occurred_at).toLocaleString("en-AU")}
              </span>
            </li>
          ))}
          {data.billingEvents.length === 0 && <li className="py-1.5 text-muted">No billing events yet.</li>}
        </ul>
      </section>
    </div>
  );
}
