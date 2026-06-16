import type { MetadataRoute } from "next";
import { getAllFixtures } from "@/lib/api";

const SITE_URL = "https://llmbets.ca";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/matches`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/history`, changeFrequency: "daily", priority: 0.6 },
  ];

  let matchRoutes: MetadataRoute.Sitemap = [];
  try {
    const fixtures = await getAllFixtures();
    matchRoutes = fixtures.map((fixture) => ({
      url: `${SITE_URL}/matches/${fixture.id}`,
      lastModified: fixture.kickoff_at,
      changeFrequency: fixture.status === "finished" ? "weekly" : "hourly",
      priority: 0.7,
    }));
  } catch {
    // API unreachable at generation time — still serve the static routes.
  }

  return [...staticRoutes, ...matchRoutes];
}
