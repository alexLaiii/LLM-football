import asyncio, sys, json
sys.path.insert(0, ".")
from app.config import settings
from app.services.football_api import fetch_match_context
from app.services.odds_api import fetch_odds
from app.services.ai.claude import ClaudePredictor
import httpx

async def main():
    headers = {"X-Auth-Token": settings.footballdata_api_key}
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "http://api.football-data.org/v4/competitions/PL/matches",
            headers=headers,
            params={"status": "TIMED,SCHEDULED"},
        )
        matches = r.json().get("matches", [])

    match = None
    for m in matches:
        home = m["homeTeam"]["name"]
        away = m["awayTeam"]["name"]
        if "Newcastle" in home and "West Ham" in away:
            match = m
            break

    if not match:
        print("No upcoming Newcastle (home) vs West Ham fixture found.")
        return

    external_id = str(match["id"])
    home_team = match["homeTeam"]["name"]
    away_team = match["awayTeam"]["name"]
    print(f"Match: {home_team} vs {away_team} | ID: {external_id} | Date: {match['utcDate']}")
    print()

    fixture = {"external_id": external_id, "home_team": home_team, "away_team": away_team, "league": "Premier League"}
    context, odds = await asyncio.gather(
        fetch_match_context(external_id),
        fetch_odds(
            external_id,
            home_team=home_team,
            away_team=away_team,
            league="Premier League",
            kickoff_at=match["utcDate"],
        ),
    )

    print("Context:", json.dumps(context, indent=2))
    print("Odds   :", json.dumps(odds, indent=2))
    print()

    result = await ClaudePredictor().predict(fixture, context, odds, 10000.0)
    print("Bet      :", result.bet_on, "@", result.odds)
    print("Confidence:", result.confidence)
    print("EV       :", result.expected_value)
    print("Stake    :", result.stake)
    print("Reasoning:", result.reasoning)

asyncio.run(main())
