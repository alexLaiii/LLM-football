# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.9] - 2026-06-24

### Added
- Changelog page added
### Changed
- The leaderboard and performance endpoints no longer load every prediction/bet row into Python for computation. They now compute totals with a single SQL GROUP BY per table in Postgres (Neon).

- Lazy-load the AI SDKs.
## [3.8] - 2026-06-20

### Added
- Manual odds fallback for matches with no bookmaker line: allow admin accounts can enter odds that drive the AI predictions and betting.

### Changed
- Switched the Gemini model to the auto-updating `gemini-pro-latest` alias.

## [3.7] - 2026-06-18

### Fixed
- Neutral-venue detection for World Cup matches: a host nation playing in its own country is now correctly treated as home, with an explicit host-nation signal sent to the models. Club matches are unaffected.

## [3.6] - 2026-06-17

### Added
- Blind AI Prediction mode — each model also predicts without seeing the bookmaker odds ("Fully decided by model" toggle on the match page).
- Leaderboard filters to view blind models alongside or instead of the original ones.

## [3.5] - 2026-06-17

### Changed
- Optimized the AI lineup summary used in the match context.

## [3.4] - 2026-06-16

### Fixed
- Live in-play odds connection.
- Team/match search matching.

## [3.3] - 2026-06-15

### Fixed
- Prematch odds bug.
- Mock-data confusion, so real vs. placeholder odds are clearly distinguished.

## [3.2] - 2026-06-14

### Changed
- Updated the Gemini model and applied minor UI fixes.

## [3.1] - 2026-06-11

### Fixed
- Starting XI representation in the match context.

## [3.0] - 2026-06-10

### Changed
- Major overhaul of the prediction prompts for all models.

## [2.0] - 2026-05-29

### Added
- Human accounts and user betting against the AI: bankrolls, leaderboard, and Compare Me to AI.
- Starting XI lineup analyzer powered by LLM and project documentation.

### Removed
- The legacy single "Sir Kim" betting tester, replaced by real user accounts.

## [1.0] - 2026-05-22

### Added
- Initial release: five AI models competing on real football matches.
