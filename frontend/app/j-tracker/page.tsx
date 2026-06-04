"use client";

import { useCallback, useEffect, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { getJTracker, resetJStreak, type JTrackerData, type JUserData } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Admin-only page: restricted to these usernames. */
const ADMIN_USERS = ["Alex", "James"];

/* ============================================================
   LOGIC — unchanged from the original page.
   ============================================================ */
function getPlanetSrc(streak: number): string {
  if (streak >= 20) return "/animations/stage_6.png";
  if (streak >= 15) return "/animations/stage_5.svg";
  if (streak >= 10) return "/animations/stage_4.lottie";
  if (streak >= 7) return "/animations/stage_3.lottie";
  if (streak >= 4) return "/animations/stage_2.lottie";
  if (streak >= 3) return "/animations/stage_1.lottie";
  return "/animations/stage_0.lottie";
}

function PlanetAnimation({ src, className }: { src: string; className: string }) {
  if (src.endsWith(".svg") || src.endsWith(".png")) {
    return <img src={src} alt="planet" className={className} />;
  }
  return <DotLottieReact src={src} loop autoplay className={className} />;
}

const START_DATE = "2026-05-20";
const USER_LABELS: Record<string, string> = { sir_kim: "Sir Kim", me: "Me" };
const USERS = ["sir_kim", "me"] as const;

type User = typeof USERS[number];

function getDayStatus(
  userData: JUserData,
  dateStr: string,
  isPast: boolean,
): "tick" | "reset" | "future" | "before_start" {
  if (dateStr < START_DATE) return "before_start";
  if (!isPast) return "future";
  if (userData.reset_dates.includes(dateStr)) return "reset";
  return "tick";
}

/* ============================================================
   MEME DRESSING — copy / captions only, no logic.
   ============================================================ */
const USER_LABELS_ZH: Record<string, string> = { sir_kim: "甘仔", me: "我" };
// power-level caption, mirrors the getPlanetSrc thresholds
function getStageCaption(streak: number): string {
  if (streak >= 20) return "ASCENDED 👑";
  if (streak >= 15) return "MAX POWER ⚡";
  if (streak >= 10) return "ON FIRE 🔥";
  if (streak >= 7) return "Getting buff 💪";
  if (streak >= 4) return "Lil sprout 🐣";
  if (streak >= 3) return "It begins…";
  return "Sadge… reset";
}

/* ============================================================
   STYLES — scoped under .jtracker-meme, does not touch globals.
   ============================================================ */
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Bangers&family=Luckiest+Guy&family=Baloo+2:wght@500;600;700;800&family=Noto+Sans+TC:wght@700;900&display=swap');

.jtracker-meme {
  --jt-ink: #141414; --jt-cream: #fff3d6; --jt-cream-2: #ffe9b0;
  --jt-blue: #2ba6ff; --jt-blue-deep: #0d6fd1; --jt-red: #ff4b4b; --jt-red-deep: #d62121;
  --jt-yellow: #ffd83d; --jt-green: #46c93a; --jt-green-deep: #2c9e23;
  --jt-orange: #ffb13e; --jt-purple: #b36be0; --jt-purple-deep: #8a3fc0;
  --jt-shadow: 6px 6px 0 var(--jt-ink); --jt-shadow-sm: 4px 4px 0 var(--jt-ink);
  --jt-shadow-xs: 3px 3px 0 var(--jt-ink); --jt-border: 4px solid var(--jt-ink);
  font-family: 'Baloo 2', 'Noto Sans TC', system-ui, sans-serif;
  color: var(--jt-ink); min-height: calc(100vh - 60px); width: 100vw; max-width: 100vw;
  margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); position: relative;
  overflow-x: hidden; padding: clamp(16px, 4vw, 48px) 16px 80px; box-sizing: border-box;
  background-color: #ffe27a;
  background-image:
    radial-gradient(circle at center, rgba(20,20,20,0.10) 1.6px, transparent 1.7px),
    radial-gradient(circle at center, rgba(255,90,40,0.08) 1.6px, transparent 1.7px);
  background-size: 22px 22px, 22px 22px; background-position: 0 0, 11px 11px;
}
.jtracker-meme *, .jtracker-meme *::before, .jtracker-meme *::after { box-sizing: border-box; }

.jtracker-bg-word {
  position: absolute; font-family: 'Bangers', cursive; font-size: clamp(60px, 12vw, 150px);
  color: rgba(20,20,20,0.05); letter-spacing: 3px; transform: rotate(-12deg);
  pointer-events: none; user-select: none; z-index: 0; white-space: nowrap;
}
.jtracker-bg-word.w1 { top: 4%; left: -2%; transform: rotate(-12deg); }
.jtracker-bg-word.w2 { top: 40%; right: -4%; transform: rotate(10deg); color: rgba(255,75,75,0.07); }
.jtracker-bg-word.w3 { bottom: 6%; left: -3%; transform: rotate(8deg); color: rgba(43,166,255,0.08); }

.jtracker-shell {
  position: relative; z-index: 1; max-width: 820px; margin: 0 auto;
  display: flex; flex-direction: column; gap: clamp(18px, 3vw, 28px);
}

.jt-header { text-align: center; position: relative; }
.jt-title {
  font-family: 'Luckiest Guy', cursive; font-weight: 400; line-height: 0.92; margin: 0;
  font-size: clamp(44px, 10vw, 92px); letter-spacing: 1px; text-transform: uppercase;
}
.jt-title .t-pink { color: var(--jt-yellow); }
.jt-title .t-blue { color: var(--jt-blue); }
.jt-title span {
  -webkit-text-stroke: 3px var(--jt-ink); paint-order: stroke fill;
  text-shadow: 4px 4px 0 var(--jt-ink), 7px 7px 0 rgba(20,20,20,0.25); display: inline-block;
}
.jt-subtitle {
  font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: clamp(15px, 2.6vw, 22px);
  margin: 14px auto 0; max-width: 560px; color: var(--jt-ink); text-wrap: balance;
}
.jt-subtitle .hi { background: var(--jt-yellow); padding: 0 6px; box-shadow: 2px 2px 0 var(--jt-ink); border: 2px solid var(--jt-ink); }

.jt-cards { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(12px, 2.4vw, 20px); }
@media (max-width: 560px) { .jt-cards { grid-template-columns: 1fr; } }

.jt-card {
  position: relative; border: var(--jt-border); border-radius: 22px; background: var(--jt-cream);
  box-shadow: var(--jt-shadow); padding: 16px 16px 18px; display: flex; flex-direction: column;
  gap: 12px; --c: var(--jt-blue); --c-deep: var(--jt-blue-deep);
}
.jt-card.is-frame { border-color: var(--c-deep); }
.jt-card::before {
  content: ""; position: absolute; inset: -4px -4px auto -4px; height: 14px; background: var(--c);
  border: var(--jt-border); border-bottom: none; border-radius: 22px 22px 0 0;
}
.jt-card.u-sir_kim { --c: var(--jt-blue); --c-deep: var(--jt-blue-deep); }
.jt-card.u-me { --c: var(--jt-red); --c-deep: var(--jt-red-deep); }

.jt-card-head { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.jt-namebubble {
  position: relative; background: #fff; border: 3px solid var(--jt-ink); border-radius: 14px;
  padding: 4px 10px; font-size: 15px; font-weight: 700; white-space: nowrap; box-shadow: var(--jt-shadow-xs);
}
.jt-namebubble::after {
  content: ""; position: absolute; bottom: -9px; left: 16px; width: 12px; height: 12px;
  background: #fff; border-right: 3px solid var(--jt-ink); border-bottom: 3px solid var(--jt-ink); transform: rotate(45deg);
}
.jt-name {
  font-family: 'Luckiest Guy', cursive; font-size: clamp(26px, 5vw, 40px); line-height: 1; color: var(--c);
  -webkit-text-stroke: 2px var(--jt-ink); paint-order: stroke fill; text-shadow: 2px 2px 0 var(--jt-ink); margin-left: auto;
}

.jt-card-body { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.jt-planet-wrap {
  position: relative; width: 116px; height: 116px; flex: none; border: 3px solid var(--jt-ink);
  border-radius: 18px;
  background: repeating-linear-gradient(45deg, rgba(0,0,0,0.04) 0 8px, transparent 8px 16px), #fff;
  display: grid; place-items: center; box-shadow: var(--jt-shadow-xs); overflow: hidden;
}
.jt-planet-wrap img, .jt-planet-wrap canvas, .jt-planet-wrap .jt-planet { width: 100%; height: 100%; object-fit: contain; }
.jt-planet-caption {
  position: absolute; top: 4px; left: 4px; font-family: 'Bangers', cursive; font-size: 11px;
  letter-spacing: 0.5px; color: var(--jt-ink); background: var(--jt-yellow); border: 2px solid var(--jt-ink);
  border-radius: 6px; padding: 0 4px; transform: rotate(-6deg); max-width: 90%; line-height: 1.3; z-index: 2;
}

.jt-streak { text-align: center; flex: 1; }
.jt-streak-num {
  font-family: 'Luckiest Guy', cursive; font-size: clamp(54px, 12vw, 84px); line-height: 0.8;
  -webkit-text-stroke: 2.5px var(--jt-ink); paint-order: stroke fill; color: #fff; text-shadow: 3px 3px 0 var(--jt-ink);
}
.jt-streak-label { font-family: 'Luckiest Guy', cursive; font-size: 20px; line-height: 1; margin-top: 6px; }

.jt-longest {
  text-align: center; font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 16px;
  background: var(--jt-cream-2); border: 3px solid var(--jt-ink); border-radius: 12px; padding: 6px; box-shadow: var(--jt-shadow-xs);
}
.jt-longest b { color: var(--jt-orange); -webkit-text-stroke: 1px var(--jt-ink); }

.jt-ministats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.jt-ministat {
  background: #fff; border: 2px solid var(--jt-ink); border-radius: 9px; padding: 3px 6px; text-align: center; line-height: 1.1;
}
.jt-ministat small { display: block; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; opacity: 0.65; }
.jt-ministat strong { font-family: 'Luckiest Guy', cursive; font-size: 15px; }

.jt-reset-btn {
  font-family: 'Luckiest Guy', cursive; font-size: 17px; letter-spacing: 0.5px; color: #fff; background: var(--c);
  border: var(--jt-border); border-radius: 14px; padding: 10px 8px 8px; cursor: pointer; box-shadow: var(--jt-shadow-sm);
  text-shadow: 2px 2px 0 rgba(0,0,0,0.35); transition: transform 0.06s ease, box-shadow 0.06s ease; line-height: 1.05;
}
.jt-reset-btn small { display: block; font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 12px; text-shadow: none; opacity: 0.95; }
.jt-reset-btn:hover { transform: translate(-1px,-1px); box-shadow: 6px 6px 0 var(--jt-ink); }
.jt-reset-btn:active { transform: translate(4px,4px); box-shadow: 1px 1px 0 var(--jt-ink); }
.jt-reset-btn:disabled { filter: grayscale(0.5) brightness(0.9); cursor: wait; }

.jt-calendar { border: var(--jt-border); border-radius: 22px; background: var(--jt-cream); box-shadow: var(--jt-shadow); padding: clamp(12px, 2.4vw, 20px); }
.jt-cal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
.jt-cal-title {
  font-family: 'Luckiest Guy', cursive; font-size: clamp(24px, 5vw, 38px); color: var(--jt-yellow);
  -webkit-text-stroke: 2px var(--jt-ink); paint-order: stroke fill; text-shadow: 3px 3px 0 var(--jt-ink); text-align: center; flex: 1;
}
.jt-cal-title small { display: block; font-family: 'Bangers'; font-size: 13px; color: var(--jt-ink); -webkit-text-stroke: 0; text-shadow: none; letter-spacing: 1px; }
.jt-nav {
  font-family: 'Luckiest Guy', cursive; width: 48px; height: 44px; flex: none; background: var(--jt-purple); color: #fff;
  border: var(--jt-border); border-radius: 4px; box-shadow: var(--jt-shadow-xs); cursor: pointer; font-size: 22px;
  display: grid; place-items: center; text-shadow: 2px 2px 0 var(--jt-purple-deep); image-rendering: pixelated;
}
.jt-nav:hover { background: var(--jt-purple-deep); }
.jt-nav:active { transform: translate(3px,3px); box-shadow: 1px 1px 0 var(--jt-ink); }

.jt-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 6px; }
.jt-weekdays div { text-align: center; font-family: 'Luckiest Guy', cursive; font-size: clamp(11px, 2.2vw, 16px); }
.jt-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.jt-day {
  position: relative; aspect-ratio: 1; border: 3px solid var(--jt-ink); border-radius: 12px; background: #fff;
  box-shadow: 2px 2px 0 var(--jt-ink); display: flex; flex-direction: column; padding: 3px; min-height: 44px; overflow: hidden;
}
.jt-day.is-pad { border: none; background: transparent; box-shadow: none; }
.jt-day.is-before { background: repeating-linear-gradient(45deg, #eadfc4 0 6px, #f3ecd6 6px 12px); opacity: 0.55; }
.jt-day.is-today { outline: 4px dashed var(--jt-purple); outline-offset: 1px; }
.jt-daynum { font-family: 'Luckiest Guy', cursive; font-size: 12px; line-height: 1; }
.jt-day.is-clean-both { background: #d6f7cf; }
.jt-day.is-reset-any { background: var(--jt-orange); }
.jt-day-big { position: absolute; inset: 0; display: grid; place-items: center; font-size: clamp(20px, 5vw, 30px); pointer-events: none; }
.jt-spark { position: absolute; top: 2px; right: 3px; font-size: 11px; }
.jt-day-badges { margin-top: auto; display: flex; gap: 2px; justify-content: center; z-index: 1; }
.jt-badge {
  width: 17px; height: 17px; border-radius: 50%; border: 2px solid var(--jt-ink); display: grid; place-items: center;
  font-size: 9px; background: #fff; line-height: 1; overflow: hidden;
}
.jt-badge.r-sir_kim { box-shadow: inset 0 0 0 2px var(--jt-blue); }
.jt-badge.r-me { box-shadow: inset 0 0 0 2px var(--jt-red); }
.jt-day-tag {
  position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%) rotate(-4deg); font-family: 'Bangers', cursive;
  font-size: 8px; background: var(--jt-ink); color: #fff; padding: 0 3px; border-radius: 3px; letter-spacing: 0.5px; white-space: nowrap;
}
.jt-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: center; margin-top: 16px; font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: 13px; }
.jt-legend span { display: inline-flex; align-items: center; gap: 6px; }

.jt-leaderboard { border: var(--jt-border); border-radius: 22px; background: var(--jt-cream); box-shadow: var(--jt-shadow); padding: clamp(14px, 2.6vw, 22px); }
.jt-lb-title {
  font-family: 'Luckiest Guy', cursive; font-size: clamp(22px, 4.6vw, 34px); text-align: center; color: var(--jt-yellow);
  -webkit-text-stroke: 2px var(--jt-ink); paint-order: stroke fill; text-shadow: 3px 3px 0 var(--jt-ink); margin-bottom: 14px;
}
.jt-lb-row {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 8px 12px;
  border: 3px solid var(--jt-ink); border-radius: 12px; background: #fff; box-shadow: var(--jt-shadow-xs); margin-bottom: 8px;
  font-family: 'Baloo 2', sans-serif; font-weight: 800; font-size: clamp(15px, 3vw, 19px);
}
.jt-lb-row.rank-1 { background: var(--jt-yellow); }
.jt-lb-row.rank-2 { background: var(--jt-cream-2); }
.jt-lb-medal { font-size: 24px; }
.jt-lb-days { font-family: 'Luckiest Guy', cursive; color: var(--jt-green-deep); white-space: nowrap; }
.jt-lb-row.is-loser .jt-lb-days { color: var(--jt-red-deep); }

.jt-modal-backdrop {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px;
  background: rgba(20,0,0,0.78);
  background-image: repeating-linear-gradient(45deg, rgba(255,0,0,0.10) 0 14px, transparent 14px 28px);
  animation: jt-flash 0.5s steps(2) 3;
}
@keyframes jt-flash { 50% { background-color: rgba(120,0,0,0.85); } }
.jt-modal {
  position: relative; width: min(460px, 100%); background: var(--jt-cream); border: 5px solid var(--jt-ink);
  border-radius: 20px; box-shadow: 10px 10px 0 var(--jt-red-deep); padding: 26px 22px 22px; text-align: center;
  opacity: 1; animation: jt-pop 0.28s cubic-bezier(0.2,1.4,0.5,1) both;
}
@keyframes jt-pop { from { transform: scale(0.82) rotate(-3deg); } to { transform: scale(1) rotate(0deg); } }
.jt-modal-banner {
  position: absolute; top: -22px; left: 50%; transform: translateX(-50%) rotate(-3deg); font-family: 'Luckiest Guy', cursive;
  font-size: 24px; color: #fff; background: var(--jt-red); border: 4px solid var(--jt-ink); border-radius: 10px; padding: 4px 18px;
  white-space: nowrap; text-shadow: 2px 2px 0 var(--jt-red-deep); box-shadow: 4px 4px 0 var(--jt-ink);
}
.jt-modal-face { font-size: 70px; line-height: 1; margin: 14px 0 6px; filter: drop-shadow(3px 3px 0 rgba(0,0,0,0.2)); animation: jt-shake 0.5s ease-in-out infinite; }
@keyframes jt-shake { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
.jt-modal-who { font-family: 'Luckiest Guy', cursive; font-size: 26px; color: var(--jt-red-deep); -webkit-text-stroke: 1px var(--jt-ink); paint-order: stroke fill; }
.jt-modal-grok {
  font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 17px; line-height: 1.4; background: #fff; border: 3px solid var(--jt-ink);
  border-radius: 14px; padding: 12px 14px; margin: 12px 0 8px; box-shadow: var(--jt-shadow-xs); text-wrap: pretty; position: relative;
}
.jt-modal-grok::before { content: "🤖 GROK SAYS:"; display: block; font-family: 'Luckiest Guy', cursive; font-size: 12px; color: var(--jt-purple-deep); margin-bottom: 4px; letter-spacing: 0.5px; }
.jt-modal-close {
  font-family: 'Luckiest Guy', cursive; font-size: 17px; color: #fff; background: var(--jt-ink); border: 4px solid var(--jt-ink);
  border-radius: 12px; padding: 9px 24px 7px; cursor: pointer; box-shadow: var(--jt-shadow-xs); margin-top: 6px;
}
.jt-modal-close:hover { background: #333; }
.jt-modal-close:active { transform: translate(3px,3px); box-shadow: none; }

.jt-loading { min-height: 70vh; display: grid; place-items: center; text-align: center; }
.jt-loading-inner { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.jt-spin-emoji { font-size: 90px; animation: jt-spin 1.1s linear infinite; }
@keyframes jt-spin { to { transform: rotate(360deg); } }
.jt-loading-msg {
  font-family: 'Luckiest Guy', cursive; font-size: clamp(20px, 4vw, 30px); -webkit-text-stroke: 1.5px var(--jt-ink);
  paint-order: stroke fill; color: var(--jt-yellow); text-shadow: 2px 2px 0 var(--jt-ink);
}
.jt-loading-bar { width: min(360px, 80vw); height: 26px; border: var(--jt-border); border-radius: 14px; background: #fff; overflow: hidden; box-shadow: var(--jt-shadow-sm); }
.jt-loading-bar i { display: block; height: 100%; width: 40%; background: repeating-linear-gradient(45deg, var(--jt-green) 0 12px, var(--jt-green-deep) 12px 24px); animation: jt-load 1.4s ease-in-out infinite; }
@keyframes jt-load { 0% { margin-left: -45%; } 100% { margin-left: 105%; } }
.jt-loading-sub { font-family: 'Baloo 2'; font-weight: 700; font-size: 14px; opacity: 0.75; }

.jt-error { min-height: 70vh; display: grid; place-items: center; text-align: center; }
.jt-error-card { background: var(--jt-cream); border: var(--jt-border); border-radius: 22px; box-shadow: var(--jt-shadow); padding: 32px 28px; max-width: 420px; }
.jt-error-face { font-size: 80px; animation: jt-shake 0.6s ease-in-out infinite; }
.jt-error-card h2 { font-family: 'Luckiest Guy', cursive; font-size: 30px; margin: 10px 0 6px; color: var(--jt-red-deep); -webkit-text-stroke: 1px var(--jt-ink); paint-order: stroke fill; }
.jt-error-card p { font-family: 'Baloo 2'; font-weight: 700; font-size: 15px; margin: 0 0 18px; }
.jt-error-card button { font-family: 'Luckiest Guy', cursive; font-size: 16px; color: #fff; background: var(--jt-blue); border: var(--jt-border); border-radius: 12px; padding: 9px 20px 7px; cursor: pointer; box-shadow: var(--jt-shadow-xs); }
.jt-error-card button:active { transform: translate(3px,3px); box-shadow: none; }
`;

function MemeStyles() {
  return <style dangerouslySetInnerHTML={{ __html: STYLES }} />;
}

/* ============================================================
   LOADING STATE
   ============================================================ */
function LoadingShell() {
  return (
    <div className="jtracker-meme">
      <MemeStyles />
      <div className="jt-loading">
        <div className="jt-loading-inner">
          <div className="jt-spin-emoji">🌀</div>
          <div className="jt-loading-msg">SUMMONING THE STREAK LEDGER…</div>
          <div className="jt-loading-bar"><i /></div>
          <div className="jt-loading-sub">don&apos;t let the meme dreams be dreams</div>
        </div>
      </div>
    </div>
  );
}

export default function JTrackerPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = !!user && ADMIN_USERS.includes(user.username);

  const [data, setData] = useState<JTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<{ open: boolean; message: string; user: string }>({
    open: false,
    message: "",
    user: "",
  });
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const fetchData = useCallback(async () => {
    const result = await getJTracker();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) fetchData(); }, [fetchData, isAdmin]);

  async function handleReset(user: User) {
    setResetting((p) => ({ ...p, [user]: true }));
    try {
      const { grok_response } = await resetJStreak(user);
      setModal({ open: true, message: grok_response, user });
      await fetchData();
    } catch {
      alert("Reset failed.");
    } finally {
      setResetting((p) => ({ ...p, [user]: false }));
    }
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  function toDateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (authLoading) return <LoadingShell />;

  if (!isAdmin) {
    return (
      <div className="jtracker-meme">
        <MemeStyles />
        <div className="jt-error">
          <div className="jt-error-card">
            <div className="jt-error-face">🔒</div>
            <h2>ADMINS ONLY.</h2>
            <p>閒人免進</p>
            <a href="/" className="jt-modal-close" style={{ display: "inline-block", textDecoration: "none" }}>
              sorry囉
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingShell />;

  if (!data) {
    return (
      <div className="jtracker-meme">
        <MemeStyles />
        <div className="jt-error">
          <div className="jt-error-card">
            <div className="jt-error-face">💀</div>
            <h2>BIG OOF.</h2>
            <p>The streak ledger ghosted us. 服务器 down bad. Refresh before the J wins.</p>
            <button type="button" onClick={() => { setLoading(true); fetchData(); }}>RETRY 🔄</button>
          </div>
        </div>
      </div>
    );
  }

  const ranked = [...USERS]
    .map((u) => ({ u, streak: data[u].current_streak }))
    .sort((a, b) => b.streak - a.streak);
  const medals = ["🥇", "💀"];

  return (
    <div className="jtracker-meme">
      <MemeStyles />
      <div className="jtracker-bg-word w1">MUCH</div>
      <div className="jtracker-bg-word w2">WOW</div>
      <div className="jtracker-bg-word w3">GING</div>

      <div className="jtracker-shell">
        <header className="jt-header">
          <h1 className="jt-title">
            <span className="t-pink">NO&nbsp;J</span> <span className="t-blue">CHALLENGE</span>
          </h1>
          <p className="jt-subtitle">Stay strong! Don&apos;t  <span className="hi">hit</span> J</p>
        </header>

        {/* ---------- USER CARDS ---------- */}
        <section className="jt-cards">
          {USERS.map((user) => {
            const ud = data[user];
            const isWinner = ud.current_streak > 0;
            return (
              <article key={user} className={`jt-card is-frame u-${user}`}>
                <div className="jt-card-head">
                  <span className="jt-namebubble">{isWinner ? "乾淨!" : "污糟!"}</span>
                  <span className="jt-name">{USER_LABELS_ZH[user]}</span>
                </div>

                <div className="jt-card-body">
                  <div className="jt-planet-wrap">
                    <span className="jt-planet-caption">{getStageCaption(ud.current_streak)}</span>
                    <PlanetAnimation src={getPlanetSrc(ud.current_streak)} className="jt-planet" />
                  </div>
                  <div className="jt-streak">
                    <div className="jt-streak-num">{ud.current_streak}</div>
                    <div className="jt-streak-label">days clean</div>
                  </div>
                </div>

                <div className="jt-longest">
                  Longest streak: <b>{ud.longest_streak} days</b>
                </div>

                <div className="jt-ministats">
                  <div className="jt-ministat"><small># RESETS</small><strong>{ud.reset_dates.length}</strong></div>
                  <div className="jt-ministat"><small>LAST RESET</small><strong>{ud.last_reset_at ? ud.last_reset_at.slice(5, 10) : "—"}</strong></div>
                </div>

                <button type="button" className="jt-reset-btn" onClick={() => handleReset(user)} disabled={resetting[user]}>
                  {resetting[user] ? "RESETTING… 💀" : (user === "sir_kim" ? "頂唔順啦!" : "頂唔緊啦!")}
                  <small>{resetting[user] ? "uploading shame…" : (user === "sir_kim" ? "我要鳩" : "我要鳩")}</small>
                </button>
              </article>
            );
          })}
        </section>

        {/* ---------- CALENDAR ---------- */}
        <section className="jt-calendar">
          <div className="jt-cal-head">
            <button type="button" className="jt-nav" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}>◀</button>
            <div className="jt-cal-title">
              {`${year}年${month + 1}月`}
              <small>{currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}</small>
            </div>
            <button type="button" className="jt-nav" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}>▶</button>
          </div>

          <div className="jt-weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
          </div>

          <div className="jt-days">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`pad-${i}`} className="jt-day is-pad" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const dateStr = toDateStr(day);
              const isToday = dateStr === todayStr;
              const isPast = dateStr <= todayStr;
              const isBeforeStart = dateStr < START_DATE;

              const statuses = USERS.map((u) => getDayStatus(data[u], dateStr, isPast));
              const active = statuses.filter((s) => s === "tick" || s === "reset");
              const anyReset = statuses.includes("reset");
              const allClean = active.length > 0 && active.every((s) => s === "tick");
              const bigIcon = active.length > 0 ? (anyReset ? "reset" : "clean") : null;
              const tag = active.length > 0 && allClean && day % 5 === 0 ? "GG!" : null;

              return (
                <div
                  key={day}
                  className={`jt-day ${isBeforeStart ? "is-before" : ""} ${isToday ? "is-today" : ""} ${allClean ? "is-clean-both" : ""} ${anyReset ? "is-reset-any" : ""}`}
                  title={statuses.map((s, i) => `${USER_LABELS[USERS[i]]}: ${s}`).join(" · ")}
                >
                  <span className="jt-daynum">{day}</span>
                  {allClean && <span className="jt-spark">✨</span>}
                  {bigIcon && (
                    <div className="jt-day-big">
                      <img src={bigIcon === "clean" ? "/memeCat_happy.jpg" : "/memeCat.jpg"} alt={bigIcon} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  )}
                  <div className="jt-day-badges">
                    {USERS.map((user) => {
                      const status = getDayStatus(data[user], dateStr, isPast);
                      if (status === "future" || status === "before_start") return null;
                      return (
                        <span
                          key={user}
                          className={`jt-badge r-${user}`}
                          title={`${USER_LABELS[user]}: ${status === "tick" ? "clean" : "reset"}`}
                        >
                          <img src={status === "tick" ? "/memeCat_happy.jpg" : "/memeCat.jpg"} alt={status === "tick" ? "clean" : "reset"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </span>
                      );
                    })}
                  </div>
                  {tag && <span className="jt-day-tag">{tag}</span>}
                </div>
              );
            })}
          </div>

          <div className="jt-legend">
            <span><span className="jt-badge r-sir_kim"><img src="/memeCat_happy.jpg" alt="clean" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span> 甘仔 Ging Clean</span>
            <span><span className="jt-badge r-me"><img src="/memeCat_happy.jpg" alt="clean" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span> Me Clean</span>
            <span><span className="jt-badge"><img src="/memeCat.jpg" alt="reset" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></span> 仆街打左 (reset)</span>
          </div>
        </section>

        {/* ---------- LEADERBOARD ---------- */}
        <section className="jt-leaderboard">
          <div className="jt-lb-title">⚔️ 強者紀錄 ⚔️</div>
          {ranked.map((row, i) => (
            <div key={row.u} className={`jt-lb-row rank-${i + 1} ${row.streak === 0 ? "is-loser" : ""}`}>
              <span className="jt-lb-medal">{medals[i]}</span>
              <span>{i + 1}. {USER_LABELS_ZH[row.u]} ({USER_LABELS[row.u]}) {row.streak === 0 ? "—廢柴" : "—堅持"}</span>
              <span className="jt-lb-days">{row.streak} days</span>
            </div>
          ))}
        </section>
      </div>

      {/* ---------- SHAME MODAL ---------- */}
      {modal.open && (
        <div className="jt-modal-backdrop" onClick={() => setModal({ open: false, message: "", user: "" })}>
          <div className="jt-modal" onClick={(event) => event.stopPropagation()}>
            <div className="jt-modal-banner">YOU HAVE FAILED 🚨</div>
            <div className="jt-modal-face">😭</div>
            <div className="jt-modal-who">{USER_LABELS_ZH[modal.user]} ({USER_LABELS[modal.user]})</div>
            <div className="jt-modal-grok">{modal.message}</div>
            <button type="button" className="jt-modal-close" onClick={() => setModal({ open: false, message: "", user: "" })}>
              OK I touch grass 🌱
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
