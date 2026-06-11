import unittest

import app.services.odds_api as odds_api
from app.services.odds_api import _names_match


class TeamNameMatchTests(unittest.TestCase):
    def test_rejects_shared_direction_token(self):
        self.assertFalse(_names_match("South Korea", "South Africa"))

    def test_rejects_shared_club_suffix_token(self):
        self.assertFalse(_names_match("Manchester United", "Newcastle United"))
        self.assertFalse(_names_match("Manchester City", "Leicester City"))

    def test_accepts_exact_and_subset_matches(self):
        self.assertTrue(_names_match("Arsenal FC", "Arsenal"))
        self.assertTrue(_names_match("Mexico", "Mexico"))

    def test_accepts_common_abbreviations(self):
        self.assertTrue(_names_match("Man United", "Manchester United"))
        self.assertTrue(_names_match("Nottm Forest", "Nottingham Forest"))


class FetchOddsMatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_fixture_kickoff_to_choose_same_date_event(self):
        async def fake_fetch_v3_events(_league_name):
            return [
                {
                    "home": "Mexico",
                    "away": "South Africa",
                    "startTime": "2026-06-19T02:00:00.000Z",
                    "markets": [
                        {
                            "canonicalMarket": "MATCH_RESULT",
                            "period": "FULL_TIME",
                            "rawName": "Full Time Result",
                            "selections": [
                                {"canonicalOutcome": "HOME", "odds": 1.75},
                                {"canonicalOutcome": "DRAW", "odds": 3.40},
                                {"canonicalOutcome": "AWAY", "odds": 4.75},
                            ],
                        }
                    ],
                },
                {
                    "home": "Mexico",
                    "away": "South Africa",
                    "startTime": "2026-06-11T20:00:00.000Z",
                    "markets": [
                        {
                            "canonicalMarket": "MATCH_RESULT",
                            "period": "FULL_TIME",
                            "rawName": "Full Time Result",
                            "selections": [
                                {"canonicalOutcome": "HOME", "odds": 1.50},
                                {"canonicalOutcome": "DRAW", "odds": 4.10},
                                {"canonicalOutcome": "AWAY", "odds": 5.75},
                            ],
                        }
                    ],
                },
            ]

        original_fetch_v3_events = odds_api._fetch_v3_league_events
        original_api_key = odds_api.settings.pulsescore_api_key
        odds_api._fetch_v3_league_events = fake_fetch_v3_events
        odds_api.settings.pulsescore_api_key = "test-key"
        try:
            odds = await odds_api.fetch_odds(
                "fixture-id",
                home_team="Mexico",
                away_team="South Africa",
                league="World Cup",
                kickoff_at="2026-06-11T20:00:00+00:00",
            )
        finally:
            odds_api._fetch_v3_league_events = original_fetch_v3_events
            odds_api.settings.pulsescore_api_key = original_api_key

        self.assertEqual(odds["home"], 1.50)
        self.assertEqual(odds["draw"], 4.10)
        self.assertEqual(odds["away"], 5.75)
        self.assertEqual(odds["kickoff_at"], "2026-06-11T20:00:00.000Z")


if __name__ == "__main__":
    unittest.main()
