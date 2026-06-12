"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: "login" | "register";
};

const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const PRINTABLE_ASCII_RE = /^[ -~]+$/;

function validateCredentials(username: string, password: string): string {
  if (!USERNAME_RE.test(username)) {
    return "Username must be 3-24 characters using only letters, numbers, underscores, or hyphens.";
  }
  if (password.length < 1 || password.length > 72) {
    return "Password must be 1-72 characters.";
  }
  if (password !== password.trim() || !PRINTABLE_ASCII_RE.test(password)) {
    return "Password can only use normal keyboard characters, with no leading or trailing spaces.";
  }
  return "";
}

export default function AuthModal({ open, onClose, onSuccess, initialMode = "login" }: Props) {
  const { login, register } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const cleanUsername = username.trim();
    const validationError = validateCredentials(cleanUsername, password);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") await login(cleanUsername, password);
      else await register(cleanUsername, password);
      setUsername("");
      setPassword("");
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Log in" : "Create an account"}
        className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl md:h-[600px] md:max-h-[calc(100vh-48px)] md:grid-cols-[1.08fr_0.92fr]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-44 overflow-hidden bg-slate-900 sm:h-52 md:h-full">
          <img
            src="/auth-stadium.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-slate-950/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 hidden p-8 text-white md:block">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">AI Football Predictor</p>
            <p className="mt-2 max-w-sm font-merriweather text-3xl font-black leading-tight">
              Place your bets and see if you can outsmart the models.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center overflow-y-auto px-6 py-8 sm:px-12 sm:py-10 md:min-h-0 md:py-12">
          <div className="w-full max-w-sm">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-wc-muted transition-colors hover:bg-wc-subtle hover:text-wc-ink"
              aria-label="Close"
            >
              &times;
            </button>

            <div className="mb-10">
              <div className="flex items-center gap-3 text-wc-ink">
                <img src="/logo.png" alt="" className="h-14 w-14 shrink-0 object-contain" />
                <div>
                  <div className="font-merriweather text-[19px] font-black leading-none">CAN AI</div>
                  <div className="font-merriweather text-[19px] font-black leading-none">WIN BETS?</div>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-wc-muted">
                {mode === "login"
                  ? "Log in to place your prediction and challenge the models."
                  : "Create your account and start with a $20,000 paper bankroll."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-wc-ink">Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_-]{3,24}"
                  title="Use 3-24 letters, numbers, underscores, or hyphens."
                  autoFocus
                  className="mt-1.5 w-full rounded-md border border-wc-border bg-white px-3 py-2.5 text-sm text-wc-ink shadow-sm outline-none transition focus:border-pos focus:ring-2 focus:ring-pos/20"
                />
                {mode === "register" && (
                  <span className="mt-1.5 block text-xs leading-relaxed text-wc-muted">
                    Use a nickname. Do not use your legal full name as your username.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-wc-ink">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={1}
                  maxLength={72}
                  title="Use 1-72 normal keyboard characters."
                  className="mt-1.5 w-full rounded-md border border-wc-border bg-white px-3 py-2.5 text-sm text-wc-ink shadow-sm outline-none transition focus:border-pos focus:ring-2 focus:ring-pos/20"
                />
              </label>

              <p className="min-h-[1rem] text-xs text-red-600" aria-live="polite">{error}</p>

              <button
                type="submit"
                disabled={submitting || !username || !password}
                className="mt-3 w-full rounded-md bg-pos px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
              </button>

              <button
                type="button"
                onClick={toggleMode}
                className="w-full rounded-md border border-pos px-4 py-2.5 text-sm font-bold text-pos transition-colors hover:bg-possoft"
              >
                {mode === "login" ? "Create Account" : "Back to Log In"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
