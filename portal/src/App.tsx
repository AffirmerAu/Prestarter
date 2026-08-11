import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Portal } from "./pages/Portal";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Same fix as admin/src/App.tsx: without this, an already-signed-in visit to /login (or any
// future in-app sign-in that doesn't leave the page, unlike a magic-link email click) would
// leave the user stuck looking at the login form with no redirect.
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <Login />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Portal />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
