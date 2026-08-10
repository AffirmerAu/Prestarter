import { useState } from "react";
import { useAuth } from "../lib/auth";

export function Login() {
  const { sendMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await sendMagicLink(email);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-sm">
        <img src="/brand/logo-horizontal.png" alt="Prestarter" className="mb-4 h-[30px] w-auto" />
        <p className="mb-6 text-sm text-muted">Sign in to manage your licensed videos.</p>
        {sent ? (
          <p className="text-sm text-body">
            Check <span className="font-medium text-ink">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              className="h-11 w-full rounded-input border border-line-strong px-3 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
            />
            <button
              type="submit"
              className="h-11 w-full rounded-input bg-primary text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press"
            >
              Send sign-in link
            </button>
            {error && <p className="text-sm text-[#B42318]">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
