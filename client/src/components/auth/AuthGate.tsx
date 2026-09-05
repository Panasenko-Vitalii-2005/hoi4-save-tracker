import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  apiFetch,
  CSRF_REJECTED_EVENT,
  SESSION_EXPIRED_EVENT,
} from "@/lib/api-client";
import "./auth.css";

interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

async function readUser(response: Response): Promise<AuthUser> {
  const body: unknown = await response.json();
  const user =
    body && typeof body === "object" && "user" in body ? body.user : null;
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string" ||
    !("email" in user) ||
    typeof user.email !== "string" ||
    !("createdAt" in user) ||
    typeof user.createdAt !== "string"
  )
    throw new Error("Invalid authentication response");
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function AuthForm({
  expired,
  onAuthenticated,
}: {
  expired: boolean;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (
      !email ||
      !password.trim() ||
      password.length < 12 ||
      password.length > 128
    ) {
      setError("Enter an email and a password of 12–128 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
        "public",
      );
      if (!response.ok) {
        setError(
          response.status === 409 && register
            ? "An account with this email already exists. Sign in instead."
            : response.status === 401
              ? "The email or password is incorrect."
              : response.status === 400
                ? "Check your email and password. Passwords must contain 12–128 characters."
                : response.status === 403
                  ? "Your security token could not be verified. Reload this page and try again."
                  : "Sign-in is temporarily unavailable. Please try again.",
        );
        return;
      }
      const user = await readUser(response);
      form.reset();
      onAuthenticated(user);
    } catch {
      setError(
        "Cannot reach the sign-in service. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="panel auth-panel" aria-labelledby="auth-title">
        <div className="eyebrow">HoI4 Save Tracker</div>
        <h1 id="auth-title">{register ? "Create an account" : "Sign in"}</h1>
        <p>
          {expired
            ? "Your session ended. Sign in again to continue."
            : "Sign in to analyze saves and explore stored campaign snapshots."}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
            disabled={busy}
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={12}
            maxLength={128}
            required
            disabled={busy}
            aria-describedby="auth-password-hint"
          />
          <small id="auth-password-hint">12–128 characters</small>
          {error && (
            <p className="auth-message" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<
    "loading" | "ready" | "signed-out" | "unavailable"
  >("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [retry, setRetry] = useState(0);
  const [expired, setExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(
          "/api/auth/me",
          { signal: controller.signal, cache: "no-store" },
          "public",
        );
        if (response.status === 401) {
          if (active) setStatus("signed-out");
          return;
        }
        if (!response.ok) throw new Error("Authentication unavailable");
        const authenticated = await readUser(response);
        if (active) {
          setUser(authenticated);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("unavailable");
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [retry]);

  useEffect(() => {
    const endSession = () => {
      setExpired(true);
      setStatus("signed-out");
      setMessage("");
    };
    const csrfFailure = () =>
      setMessage(
        "Your security token could not be verified. Reload this page before trying the action again.",
      );
    window.addEventListener(SESSION_EXPIRED_EVENT, endSession);
    window.addEventListener(CSRF_REJECTED_EVENT, csrfFailure);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, endSession);
      window.removeEventListener(CSRF_REJECTED_EVENT, csrfFailure);
    };
  }, []);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setMessage("");
    try {
      const response = await apiFetch(
        "/api/auth/logout",
        { method: "POST" },
        "public",
      );
      if (!response.ok) throw new Error("Logout unavailable");
      setUser(null);
      setExpired(false);
      setStatus("signed-out");
    } catch {
      setMessage("Could not sign out. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      {status === "loading" && (
        <main className="auth-page">
          <section className="panel auth-panel" role="status">
            Checking your session…
          </section>
        </main>
      )}
      {status === "unavailable" && (
        <main className="auth-page">
          <section className="panel auth-panel" role="alert">
            <h1>Sign-in unavailable</h1>
            <p>
              Cannot check your session. Check that the service is running and
              try again.
            </p>
            <button
              className="button button-secondary"
              onClick={() => {
                setStatus("loading");
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </button>
          </section>
        </main>
      )}
      {status === "signed-out" && (
        <AuthForm
          expired={expired}
          onAuthenticated={(authenticated) => {
            setUser(authenticated);
            setStatus("ready");
            setExpired(false);
            setMessage("");
          }}
        />
      )}
      {/* Preserve loaded UI after expiry for the same account. Initial auth never
        mounts it; explicit logout or a different account discards its state. */}
      {user && (
        <div
          key={user.id}
          hidden={status !== "ready"}
          inert={status !== "ready"}
        >
          <div className="auth-account">
            <span>
              Signed in as <strong>{user.email}</strong>
            </span>
            <button
              className="button button-secondary"
              disabled={loggingOut}
              onClick={logout}
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
            {message && <p role="alert">{message}</p>}
          </div>
          {children}
        </div>
      )}
    </>
  );
}
