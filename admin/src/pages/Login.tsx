import { useState } from "react";
import { useAuth } from "../lib/auth";

export function Login() {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signInWithPassword(email, password);
    if (error) setError(error);
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-sm">
        <img src="/brand/mark.png" alt="" className="mb-4 h-10 w-10" />
        <h1 className="mb-1 text-h3 font-semibold text-ink">Prestarter admin</h1>
        <p className="mb-6 text-sm text-muted">Sign in with your Affirmer email and password.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@affirmer.com.au"
            className="h-10 w-full rounded-input border border-line-strong px-3 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-10 w-full rounded-input border border-line-strong px-3 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/24"
          />
          <button
            type="submit"
            disabled={submitting}
            className="h-10 w-full rounded-input bg-primary text-sm font-semibold text-white shadow-xs hover:bg-primary-hover active:bg-primary-press disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="text-sm text-[#B42318]">{error}</p>}
        </form>
      </div>
    </div>
  );
}
