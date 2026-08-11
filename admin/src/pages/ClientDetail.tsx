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

interface CatalogueVideo {
  id: string;
  title: string;
  display_code: string;
  status: string;
}

function isActiveEntitlement(effectiveTo: string | null): boolean {
  return !effectiveTo || effectiveTo >= new Date().toISOString().slice(0, 10);
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
  const [catalogue, setCatalogue] = useState<CatalogueVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");
  const [editEmailError, setEditEmailError] = useState<string | null>(null);

  async function load() {
    const [d, videosResp] = await Promise.all([
      apiGet<ClientDetailData>(`/internal/clients/${id}`),
      apiGet<{ videos: CatalogueVideo[] }>("/internal/videos"),
    ]);
    setData(d);
    setCatalogue(videosResp.videos);
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

  async function addVideo() {
    if (!selectedVideoId) return;
    setBusy(true);
    await apiPost(`/internal/clients/${id}/entitlements`, { video_id: selectedVideoId });
    setSelectedVideoId("");
    await load();
    setBusy(false);
  }

  async function removeVideo(entitlementId: string, title: string) {
    if (!confirm(`Remove "${title}" from this client? Their existing links and posters for it will stop working immediately.`)) return;
    setBusy(true);
    await apiPost(`/internal/entitlements/${entitlementId}/revoke`, {});
    await load();
    setBusy(false);
  }

  function startEditEmail(contactId: string, currentEmail: string) {
    setEditingContactId(contactId);
    setEditEmailValue(currentEmail);
    setEditEmailError(null);
  }

  function cancelEditEmail() {
    setEditingContactId(null);
    setEditEmailValue("");
    setEditEmailError(null);
  }

  async function saveEmail(contactId: string) {
    setBusy(true);
    setEditEmailError(null);
    try {
      await apiPost(`/internal/client-contacts/${contactId}/update-email`, { email: editEmailValue.trim() });
      setEditingContactId(null);
      setEditEmailValue("");
      await load();
    } catch {
      setEditEmailError("Couldn't update the email — it may already be in use by another contact.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { client } = data;
  const activeKey = data.keys.find((k) => !k.revoked_at);
  const entitledVideoIds = new Set(data.entitlements.filter((e) => isActiveEntitlement(e.effective_to)).map((e) => e.video_id));
  const availableToAdd = catalogue.filter((v) => !entitledVideoIds.has(v.id) && v.status !== "archived");

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
          <ul className="space-y-2 text-sm">
            {data.contacts.map((c) => (
              <li key={c.id}>
                {editingContactId === c.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-ink">{c.name}</span>
                    <input
                      type="email"
                      value={editEmailValue}
                      onChange={(e) => setEditEmailValue(e.target.value)}
                      className="flex-1 rounded-input border border-line-strong px-2 py-1 text-sm text-ink focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
                      autoFocus
                    />
                    <button onClick={() => saveEmail(c.id)} disabled={busy || !editEmailValue.trim()} className="text-xs font-medium text-primary-press hover:underline disabled:opacity-50">
                      Save
                    </button>
                    <button onClick={cancelEditEmail} disabled={busy} className="text-xs font-medium text-muted hover:underline disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-ink">{c.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted">{c.email}</span>
                      <button onClick={() => startEditEmail(c.id, c.email)} className="text-xs font-medium text-muted hover:underline">
                        Edit
                      </button>
                    </div>
                  </div>
                )}
                {editingContactId === c.id && editEmailError && <p className="mt-1 text-xs text-[#B42318]">{editEmailError}</p>}
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
        <ul className="mb-4 divide-y divide-[#F2F4F7]">
          {data.entitlements.map((e) => {
            const active = isActiveEntitlement(e.effective_to);
            return (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-ink">
                    {e.videos.title}
                    {!active && (
                      <span className="ml-2 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs font-semibold text-[#475467]">
                        removed
                      </span>
                    )}
                  </div>
                  <div className="text-muted">{e.videos.display_code}</div>
                </div>
                {active && (
                  <div className="flex items-center gap-3">
                    {activeKey && (
                      <>
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
                      </>
                    )}
                    <button
                      onClick={() => removeVideo(e.id, e.videos.title)}
                      disabled={busy}
                      className="text-[#B42318] hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {data.entitlements.length === 0 && <li className="py-2 text-sm text-muted">No entitlements yet.</li>}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <select
            value={selectedVideoId}
            onChange={(e) => setSelectedVideoId(e.target.value)}
            className="rounded-input border border-line-strong px-2.5 py-1.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
          >
            <option value="">Add a video…</option>
            {availableToAdd.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} ({v.display_code})
              </option>
            ))}
          </select>
          <button onClick={addVideo} disabled={!selectedVideoId || busy} className={primaryBtnClass}>
            Add
          </button>
          {activeKey && (
            <button onClick={() => openAsset(`/internal/clients/${client.id}/poster.png`)} className={secondaryBtnClass}>
              Export poster (PNG)
            </button>
          )}
        </div>
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
