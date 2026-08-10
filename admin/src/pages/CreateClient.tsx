import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../lib/api";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFrom(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

interface CreateClientResponse {
  id: string;
  access_key: string;
  onboarding_email_sent: boolean | null;
}

export function CreateClient() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [markAs, setMarkAs] = useState("");
  const [planTier, setPlanTier] = useState("standard");
  const [termStart, setTermStart] = useState(todayISO());
  const [termEnd, setTermEnd] = useState(oneYearFrom(todayISO()));
  const [dailyCap, setDailyCap] = useState(50);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<CreateClientResponse>("/internal/clients", {
        name,
        // mark_as is the watermark text (spec section 7) — defaults to the client name
        // rather than leaving it blank when left untouched.
        mark_as: markAs.trim() || name,
        plan_tier: planTier,
        term_start: termStart,
        term_end: termEnd,
        daily_cap_advisory: dailyCap,
        contact_name: contactName.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
      });
      if (contactEmail.trim() && result.onboarding_email_sent === false) {
        window.alert("Client created, but the onboarding email failed to send. Check Resend and try inviting the contact again from the client page.");
      }
      navigate(`/clients/${result.id}`);
    } catch {
      setError("Something went wrong creating the client. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "mt-1 h-10 w-full rounded-input border border-line-strong px-3 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24";
  const labelClass = "block text-label uppercase text-muted";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-h1 font-bold text-ink">New client</h1>
      <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-surface p-5">
        <div>
          <label className={labelClass}>Client name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Pty Ltd"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Watermark text <span className="font-normal normal-case text-subtle">(defaults to client name)</span>
          </label>
          <input
            type="text"
            value={markAs}
            onChange={(e) => setMarkAs(e.target.value)}
            placeholder={name || "Acme Pty Ltd"}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Plan tier</label>
            <input
              type="text"
              required
              value={planTier}
              onChange={(e) => setPlanTier(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Daily play cap (advisory)</label>
            <input
              type="number"
              required
              min={1}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Term start</label>
            <input
              type="date"
              required
              value={termStart}
              onChange={(e) => setTermStart(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Term end</label>
            <input
              type="date"
              required
              value={termEnd}
              onChange={(e) => setTermEnd(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          The billing state starts as "paid" through the term end — adjust from the client page afterward if this
          client is invoiced differently. An access key is generated automatically.
        </p>

        <div className="border-t border-line pt-4">
          <p className="mb-2 text-label uppercase text-body">
            First contact <span className="font-normal normal-case text-subtle">(optional — can be added later)</span>
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Name</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          {contactEmail.trim() && (
            <p className="mt-2 text-xs text-muted">
              This contact will be emailed a welcome message pointing them to the portal to sign in.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-[#B42318]">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="h-10 rounded-input bg-primary px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:cursor-not-allowed disabled:bg-line disabled:text-subtle"
        >
          {submitting ? "Creating…" : "Create client"}
        </button>
      </form>
    </div>
  );
}
