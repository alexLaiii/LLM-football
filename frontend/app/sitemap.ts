import type { MetadataRoute } from "next";

const SITE_URL = "https://llmbets.ca";

export default function sitemap(): MetadataRoute.Sitemap {
  // Individual match pages (/matches/[id]) are intentionally excluded — they're
  // disallowed in robots.ts to avoid per-page odds API calls from crawlers.
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/matches`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/history`, changeFrequency: "daily", priority: 0.6 },
  ];
}
