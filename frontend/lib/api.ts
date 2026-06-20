const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const retryAfterValue = Number(res.headers.get("Retry-After"));
  const retryAfter = Number.isFinite(retryAfterValue) && retryAfterValue > 0 ? retryAfterValue : null;
  let message = fallback;
  const body = await res.text();

  if (body.trim()) {
    try {
      const data = JSON.parse(body);
      if (typeof data?.detail === "string" && data.detail.trim()) {
        message = data.detail;
      } else if (Array.isArray(data?.detail) && typeof data.detail[0]?.msg === "string") {
        message = data.detail[0].msg.replace(/^Value error,\s*/i, "");
      } else {
        message = body;
      }
    } catch {
      message = body;
    }
  }

  if (res.status === 429) {
    message = retryAfter
      ? `Too many requests. Please wait ${retryAfter} seconds before trying again.`
      : "Too many requests. Please wait a moment before trying again.";
  }

  throw new ApiError(message, res.status, retryAfter);
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Fixture = {
  id: number;
  external_id: string;
  home_team: string;
  away_team: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_crest: string | null;
  away_team_crest: string | null;
  league: string;
  kickoff_at: string;
  status: "scheduled" | "finished";
  result: "home" | "draw" | "away" | null;
  home_goals: number | null;
  away_goals: number | null;
};

export type Prediction = {
  id: number;
  fixture_id: number;
  model_name: string;
  home_prob: number;
  draw_prob: number;
  away_prob: number;
  bet_on: "home" | "draw" | "away";
  confidence: number;
  expected_value: number;
  stake: number;
  odds: number;
  odds_home: number | null;
  odds_draw: number | null;
  odds_away: number | null;
  reasoning: string;
  prompt_snapshot: string | null;
  status: "pending" | "won" | "lost" | "void";
  profit_loss: number | null;
  settled_at: string | null;
  created_at: string;
  home_value_score: number | null;
  draw_value_score: number | null;
  away_value_score: number | null;
};

// `predictions` holds the original bookmaker-aware models; `blind_predictions`
// holds the blind models (stored in a separate backend table).
export type FixtureWithPredictions = Fixture & { predictions: Prediction[]; blind_predictions: Prediction[] };

export async function getFixtures(): Promise<Fixture[]> {
  try {
    const res = await fetch(`${API_URL}/fixtures/`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function getFixture(id: number): Promise<FixtureWithPredictions | null> {
  try {
    const res = await fetch(`${API_URL}/fixtures/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export type Odds = {
  home: number;
  draw: number;
  away: number;
  kickoff_at: string | null;
  available: boolean;
  live: boolean;
};

export async function getOdds(fixtureId: number): Promise<Odds | null> {
  try {
    const res = await fetch(`${API_URL}/fixtures/${fixtureId}/odds`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function getLineupAvailable(fixtureId: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/fixtures/${fixtureId}/lineup-available`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.available);
  } catch { return false; }
}

export type LineupPlayer = {
  name: string;
  number: number | null;
  pos: string;
  grid: string | null;
};

export type TeamLineup = {
  team: string;
  formation: string;
  players: LineupPlayer[];
};

export type LineupDetails = {
  home: TeamLineup | null;
  away: TeamLineup | null;
};

export async function getLineupDetails(fixtureId: number): Promise<LineupDetails | null> {
  try {
    const res = await fetch(`${API_URL}/fixtures/${fixtureId}/lineup`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function syncFixtures(): Promise<Fixture[]> {
  const res = await fetch(`${API_URL}/fixtures/sync`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "Fixture sync failed");
  return res.json();
}

export async function requestPredictions(fixtureId: number): Promise<Prediction[]> {
  const res = await fetch(`${API_URL}/predictions/request/${fixtureId}`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "Prediction request failed");
  return res.json();
}

// TEMPORARY: manual odds override (allow-listed accounts only). Runs a
// prediction run with the given odds in the background on the backend.
export async function triggerManualOddsPredictions(
  token: string,
  fixtureId: number,
  odds: { home: number; draw: number; away: number },
): Promise<void> {
  const res = await fetch(`${API_URL}/predictions/manual-odds/${fixtureId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(odds),
  });
  if (!res.ok) await throwApiError(res, "Manual odds prediction failed");
}

export async function getPredictions(): Promise<Prediction[]> {
  try {
    const res = await fetch(`${API_URL}/predictions/`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function getAllFixtures(): Promise<Fixture[]> {
  try {
    const res = await fetch(`${API_URL}/fixtures/?include_past=true`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export type JUserData = {
  current_streak: number;
  longest_streak: number;
  last_reset_at: string | null;
  reset_dates: string[];
};

export type JTrackerData = {
  sir_kim: JUserData;
  me: JUserData;
};

export async function getJTracker(): Promise<JTrackerData | null> {
  try {
    const res = await fetch(`${API_URL}/j-tracker/`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function resetJStreak(user: string): Promise<{ grok_response: string }> {
  const res = await fetch(`${API_URL}/j-tracker/${user}/reset`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "Reset failed");
  return res.json();
}

// ───── Auth / User bets ─────

export type AuthUser = { id: number; username: string };
export type AuthResult = { token: string; user: AuthUser };

export async function registerUser(username: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) await throwApiError(res, "Registration failed");
  return res.json();
}

export async function loginUser(username: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) await throwApiError(res, "Login failed");
  return res.json();
}

export async function getMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export type UserBet = {
  id: number;
  user_id: number;
  fixture_id: number;
  bet_on: "home" | "draw" | "away";
  stake: number;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
  profit_loss: number | null;
  settled_at: string | null;
  created_at: string;
};

export type LeaderboardEntry = {
  kind: "ai" | "user";
  name: string;
  display_name: string;
  blind?: boolean;   // true for blind AI identities (e.g. "claude_blind")
  bankroll: number;
  total_bets: number;
  won: number;
  lost: number;
  pending: number;
  win_rate: number;
  roi: number;
  total_profit_loss: number;
  recent_form?: string[];   // last up to 5 settled results, chronological: "W" | "L"
};

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(`${API_URL}/bets/leaderboard`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function getMyBankroll(token: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/bets/me/bankroll`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.bankroll;
  } catch { return null; }
}

export async function getMyBets(token: string): Promise<UserBet[]> {
  try {
    const res = await fetch(`${API_URL}/bets/me`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function getMyBetForFixture(
  token: string,
  fixtureId: number,
): Promise<UserBet | null> {
  try {
    const res = await fetch(`${API_URL}/bets/me/by-fixture/${fixtureId}`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function placeUserBet(
  token: string,
  fixtureId: number,
  bet_on: "home" | "draw" | "away",
  stake: number,
): Promise<UserBet> {
  const res = await fetch(`${API_URL}/bets/${fixtureId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ bet_on, stake }),
  });
  if (!res.ok) await throwApiError(res, "Bet failed");
  return res.json();
}

export type CompareEntry = {
  fixture_id: number;
  home_team: string;
  away_team: string;
  league: string;
  kickoff_at: string;
  result: "home" | "draw" | "away" | null;
  user_bet: UserBet;
  ai_predictions: Prediction[];
};

export type CompareSummary = {
  user_pl: number;
  ai_pl: number;
  user_win_rate: number;
  ai_win_rate: number;
  matches_bet: number;
};

export type CompareData = { summary: CompareSummary; entries: CompareEntry[] };

export async function getCompare(token: string): Promise<CompareData | null> {
  try {
    const res = await fetch(`${API_URL}/bets/me/compare`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}
