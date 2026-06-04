import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


@dataclass(frozen=True)
class RateRule:
    methods: set[str]
    prefix: str
    limit: int
    window_seconds: int


RULES = [
    RateRule({"POST"}, "/auth/login", 10, 60),
    RateRule({"POST"}, "/auth/register", 5, 60),
    RateRule({"POST"}, "/predictions/request", 3, 3600),
    RateRule({"POST"}, "/fixtures/sync", 2, 300),
    RateRule({"GET"}, "/fixtures", 120, 60),
    RateRule({"GET"}, "/bets/leaderboard", 120, 60),
    RateRule({"GET"}, "/predictions", 60, 60),
    RateRule({"GET", "POST"}, "/", 240, 60),
]


class InMemoryRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[tuple[str, str, str], Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        rule = self._match_rule(request)
        if rule is None:
            return await call_next(request)

        now = time.monotonic()
        client = self._client_key(request)
        key = (client, request.method.upper(), rule.prefix)
        hits = self._hits[key]
        cutoff = now - rule.window_seconds
        while hits and hits[0] < cutoff:
            hits.popleft()

        if len(hits) >= rule.limit:
            retry_after = max(1, int(rule.window_seconds - (now - hits[0])))
            return JSONResponse(
                {"detail": "Rate limit exceeded. Try again later."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)
        return await call_next(request)

    @staticmethod
    def _client_key(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    @staticmethod
    def _match_rule(request: Request) -> RateRule | None:
        method = request.method.upper()
        path = request.url.path
        for rule in RULES:
            if method in rule.methods and path.startswith(rule.prefix):
                return rule
        return None
