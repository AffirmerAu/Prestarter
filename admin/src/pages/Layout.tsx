import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-primary-tint text-primary-press" : "text-white/70 hover:bg-white/10 hover:text-white"
  }`;
}

export function Layout() {
  const { session, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="bg-surface-inverse">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <img src="/brand/logo-horizontal-reverse.png" alt="Prestarter" className="h-[26px] w-auto" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Admin</span>
            </div>
            <nav className="flex gap-1">
              <NavLink to="/" end className={navClass}>
                Dashboard
              </NavLink>
              <NavLink to="/clients" className={navClass}>
                Clients
              </NavLink>
              <NavLink to="/videos" className={navClass}>
                Video library
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-white/60">
            <span>{session?.user.email}</span>
            <button onClick={signOut} className="text-white/50 hover:text-white">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
