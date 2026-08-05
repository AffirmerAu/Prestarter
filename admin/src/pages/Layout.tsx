import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded px-3 py-1.5 text-sm font-medium ${
    isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
  }`;
}

export function Layout() {
  const { session, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-gray-900">Prestarter admin</span>
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
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{session?.user.email}</span>
            <button onClick={signOut} className="text-gray-400 hover:text-gray-700">
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
