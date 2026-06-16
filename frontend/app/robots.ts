import type { MetadataRoute } from "next";

const SITE_URL = "https://llmbets.ca";

export default function robots(): MetadataRoute.Robots {
  return {
    // Disallow individual match detail pages: they trigger a per-page odds API
    // call, and we don't need them indexed. The /matches list stays crawlable
    // ("/matches" has no trailing slash so it isn't matched by "/matches/").
    rules: { userAgent: "*", allow: "/", disallow: "/matches/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
