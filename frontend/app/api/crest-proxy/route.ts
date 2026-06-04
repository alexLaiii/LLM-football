import { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "media.api-sports.io",
]);
const WINDOW_MS = 60_000;
const LIMIT = 60;
const buckets = new Map<string, number[]>();

function clientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimited(key: string) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (hits.length >= LIMIT) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

export async function GET(request: NextRequest) {
  const key = clientKey(request);
  if (rateLimited(key)) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new Response("Missing url", { status: 400 });

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }

  if (!upstream.ok) return new Response("Upstream error", { status: 502 });

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  if (!contentType.startsWith("image/")) {
    return new Response("Unsupported content type", { status: 415 });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
