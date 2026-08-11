import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Layout } from "./pages/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Clients } from "./pages/Clients";
import { CreateClient } from "./pages/CreateClient";
import { ClientDetail } from "./pages/ClientDetail";
import { Videos } from "./pages/Videos";
import { VideoDetail } from "./pages/VideoDetail";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// The /login route itself never used to check for an existing session — after
// signInWithPassword succeeds, AuthProvider's session state updates, but nothing was
// listening for that on THIS route to navigate away. The old magic-link flow never hit this:
// clicking the emailed link always landed on a fresh page load at "/", not "/login". Password
// login has no such external hop, so without this the UI just sits on the login form with no
// error and no visible feedback even though sign-in already succeeded (user-reported: "I
// can't login" — confirmed via direct API calls that the credentials and worker auth were
// both fine; the bug was purely this missing redirect).
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
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/new" element={<CreateClient />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="videos" element={<Videos />} />
            <Route path="videos/:id" element={<VideoDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
