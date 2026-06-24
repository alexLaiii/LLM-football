import { readFileSync } from "fs";
import path from "path";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog & Updates",
  description:
    "Release notes and updates for the AI football prediction platform — new features, fixes and model changes over time.",
  alternates: { canonical: "/changelog" },
};

// Single source of truth: the repo's CHANGELOG.md (Keep a Changelog format).
// Read at build time and rendered below. To add an update, edit CHANGELOG.md —
// no code changes needed.
function loadChangelog(): string {
  // Works whether the build root is the repo or the frontend/ directory.
  const candidates = [
    path.join(process.cwd(), "CHANGELOG.md"),
    path.join(process.cwd(), "..", "CHANGELOG.md"),
  ];
  for (const file of candidates) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      /* try next candidate */
    }
  }
  return "";
}

type Category = { name: string; items: string[] };
type Release = { version: string; date: string | null; categories: Category[] };

function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let category: Category | null = null;

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();

    const versionMatch = line.match(/^##\s+\[([^\]]+)\]\s*(?:[-–]\s*(.+))?$/);
    if (versionMatch) {
      release = { version: versionMatch[1].trim(), date: versionMatch[2]?.trim() || null, categories: [] };
      releases.push(release);
      category = null;
      continue;
    }

    const categoryMatch = line.match(/^###\s+(.+)$/);
    if (categoryMatch && release) {
      category = { name: categoryMatch[1].trim(), items: [] };
      release.categories.push(category);
      continue;
    }

    const itemMatch = line.match(/^[-*]\s+(.+)$/);
    if (itemMatch && category) {
      category.items.push(itemMatch[1].replace(/`/g, "").trim());
    }
  }

  // Drop releases with no content (e.g. an empty Unreleased section).
  return releases.filter((r) => r.categories.some((c) => c.items.length > 0));
}

// Keep a Changelog's standard categories, color-coded to the terminal theme.
const CATEGORY_STYLES: Record<string, string> = {
  Added: "border-[rgba(56,209,124,.45)] text-[var(--term-pos)]",
  Changed: "border-[rgba(255,180,84,.42)] text-[var(--term-amber)]",
  Fixed: "border-[rgba(92,200,255,.45)] text-[var(--term-cyan)]",
  Deprecated: "border-[var(--term-border-2)] text-[var(--term-muted)]",
  Removed: "border-[rgba(255,89,112,.45)] text-[var(--term-neg)]",
  Security: "border-[rgba(255,89,112,.45)] text-[var(--term-neg)]",
};

function categoryStyle(name: string) {
  return CATEGORY_STYLES[name] ?? "border-[var(--term-border-2)] text-[var(--term-muted)]";
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

export default function ChangelogPage() {
  const releases = parseChangelog(loadChangelog());

  return (
    <div className="terminal-page">
      <div className="terminal-content">
        <header className="terminal-hero">
          <div className="terminal-tags">
            <span>SYS://CHANGELOG</span>
            <span className="is-ghost">Updates &amp; release notes</span>
          </div>
          <h1>Changelog<span /></h1>
          <p>Release Notes and Version history</p>
        </header>

        {releases.length === 0 ? (
          <div className="border border-dashed border-[var(--term-border-2)] p-10 text-center font-mono text-[12px] text-[var(--term-dim)]">
            No changelog entries yet.
          </div>
        ) : (
          <ol className="grid gap-3.5 pb-12">
            {releases.map((release) => (
              <li
                key={`${release.version}-${release.date ?? "x"}`}
                className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2.5 border-b border-[var(--term-border)] pb-2.5">
                  <span className="font-mono text-sm font-semibold text-[var(--term-text)]">{release.version}</span>
                  {release.date && (
                    <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">
                      {formatDate(release.date)}
                    </span>
                  )}
                </div>

                <div className="grid gap-3">
                  {release.categories
                    .filter((c) => c.items.length > 0)
                    .map((category) => (
                      <div key={category.name}>
                        <span className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${categoryStyle(category.name)}`}>
                          {category.name}
                        </span>
                        <ul className="mt-2 grid gap-2">
                          {category.items.map((item, i) => (
                            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--term-muted)]">
                              <span className="mt-[7px] h-[5px] w-[5px] flex-none bg-[var(--accent,var(--term-pos))]" aria-hidden="true" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
