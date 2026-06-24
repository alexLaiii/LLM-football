"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import AuthModal from "@/components/AuthModal";

const NAV_LINKS = [
  { href: "/",          label: "Leaderboard",      code: "LB" },
  { href: "/matches",   label: "Matches",          code: "MX" },
  { href: "/history",   label: "AI History",       code: "HX" },
  { href: "/compare",   label: "Compare Me to AI", code: "CM" },
  { href: "/changelog", label: "Changelog",        code: "CL" },
  { href: "/j-tracker", label: "J Tracker",        code: "JT" },
];

const cn = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

function Monogram({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn("terminal-monogram", compact && "is-compact")}>
      <img src="/icon.png" alt="Can AI Win Bets" />
    </span>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <nav className="terminal-nav-links" aria-label="Primary">
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn("terminal-nav-link", isActive(link.href) && "is-active")}
          title={link.label}
          onClick={onNavigate}
        >
          <span className="terminal-nav-code">{link.code}</span>
          <span className="terminal-nav-label">{link.label}</span>
          <span className="terminal-nav-route">{link.href}</span>
        </Link>
      ))}
    </nav>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    setCollapsed(localStorage.getItem("cawb.nav.collapsed") === "1");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>("a, button");
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("cawb.nav.collapsed", next ? "1" : "0");
      document.documentElement.style.setProperty("--sidebar-w", next ? "64px" : "260px");
      return next;
    });
  }

  const initial = user?.username.charAt(0).toUpperCase() ?? "?";

  const authFooter = (
    <div className="terminal-nav-footer">
      {user ? (
        <>
          <div className="terminal-nav-user">
            <span className="terminal-avatar">{initial}</span>
            <span className="terminal-user-copy">
              <strong>{user.username}</strong>
              <small>SIGNED · LVL 04</small>
            </span>
          </div>
          <button type="button" className="terminal-logout" onClick={logout}>
            LOG OUT <LogOut size={12} aria-hidden="true" />
          </button>
        </>
      ) : (
        <button type="button" className="terminal-login" onClick={() => setAuthOpen(true)}>
          LOG IN / SIGN UP
        </button>
      )}
    </div>
  );

  return (
    <>
      <header className="terminal-mobile-bar">
        <Link href="/" className="terminal-mobile-brand" onClick={() => setMobileOpen(false)}>
          <Monogram compact />
          <span>Can AI Win Bets</span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="terminal-mobile-menu"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      {mobileOpen && (
        <div ref={drawerRef} className="terminal-mobile-drawer" role="dialog" aria-label="Navigation menu">
          <div className="terminal-nav-section">NAV ── 0x01</div>
          <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          {authFooter}
        </div>
      )}

      <aside className={cn("terminal-sidebar", collapsed && "is-collapsed")}>
        <Link href="/" className="terminal-sidebar-brand">
          <Monogram />
          <span className="terminal-brand-copy">
            <strong>Can AI Win Bets</strong>
            <small>Five models place their bets on football matches</small>
          </span>
        </Link>
        <div className="terminal-nav-section">NAV ── 0x01</div>
        <NavLinks pathname={pathname} />
        {authFooter}
        <button
          type="button"
          className="terminal-sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </aside>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
