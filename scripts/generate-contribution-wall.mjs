import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.PROFILE_PAT;
const expectedOwner = process.env.PROFILE_OWNER || process.env.GITHUB_REPOSITORY_OWNER;

if (!token) {
  throw new Error(
    "Missing PROFILE_PAT. Add an Actions secret named PROFILE_PAT. For private contribution counts use read:user; for private repository language stats also grant repo."
  );
}

const api = async (query, variables = {}) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "jease0502-private-profile-metrics",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL error: ${response.status} ${JSON.stringify(payload.errors || payload)}`
    );
  }
  return payload.data;
};

const to = new Date();
const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

const profileQuery = `
  query Profile($from: DateTime!, $to: DateTime!, $after: String) {
    viewer {
      login
      repositories(
        first: 100
        after: $after
        ownerAffiliations: OWNER
        isFork: false
        orderBy: {field: UPDATED_AT, direction: DESC}
      ) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          isPrivate
          visibility
          diskUsage
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        contributionCalendar {
          totalContributions
          months { firstDay name totalWeeks year }
          weeks {
            firstDay
            contributionDays {
              date
              weekday
              contributionCount
              contributionLevel
              color
            }
          }
        }
      }
    }
  }
`;

let after = null;
let viewer = null;
let repositories = [];
let repoTotal = 0;

do {
  const data = await api(profileQuery, {
    from: from.toISOString(),
    to: to.toISOString(),
    after,
  });
  viewer = data.viewer;

  if (!viewer) throw new Error("GitHub GraphQL returned no viewer.");
  if (expectedOwner && viewer.login.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(
      `PROFILE_PAT belongs to @${viewer.login}, but the profile repository belongs to @${expectedOwner}.`
    );
  }

  const page = viewer.repositories;
  repoTotal = page.totalCount;
  repositories.push(...page.nodes);
  after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (after);

const collection = viewer.contributionsCollection;
const calendar = collection.contributionCalendar;
const weeks = calendar.weeks;
const days = weeks.flatMap((week) => week.contributionDays);

if (!weeks.length || !days.length) throw new Error("No contribution calendar data returned.");

const activeDays = days.filter((d) => d.contributionCount > 0).length;
const peakDay = Math.max(...days.map((d) => d.contributionCount));
const total = calendar.totalContributions;
const restricted = collection.restrictedContributionsCount;
const privateRepos = repositories.filter((r) => r.isPrivate).length;
const publicRepos = repositories.filter((r) => !r.isPrivate).length;

const languageMap = new Map();
for (const repo of repositories) {
  for (const edge of repo.languages?.edges || []) {
    const key = edge.node.name;
    const current = languageMap.get(key) || { size: 0, color: edge.node.color || "#8b949e" };
    current.size += edge.size || 0;
    if (!current.color && edge.node.color) current.color = edge.node.color;
    languageMap.set(key, current);
  }
}
const languages = [...languageMap.entries()]
  .map(([name, value]) => ({ name, ...value }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 8);
const languageTotal = languages.reduce((sum, l) => sum + l.size, 0) || 1;

const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const updatedAt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
}).format(to);

const width = 1100;
const wallHeight = 286;
const gridX = 100;
const gridY = 86;
const cell = 13;
const gap = 4;
const step = cell + gap;

const weekEnd = (week) =>
  week.contributionDays[week.contributionDays.length - 1]?.date || week.firstDay;

const monthLabels = calendar.months.map((month) => {
  let index = weeks.findIndex(
    (week) => month.firstDay >= week.firstDay && month.firstDay <= weekEnd(week)
  );
  if (index < 0) index = weeks.findIndex((week) => week.firstDay >= month.firstDay);
  if (index < 0) return "";
  return `<text x="${gridX + index * step}" y="67" class="month">${xml(month.name.slice(0, 3))}</text>`;
}).filter(Boolean).join("\n");

const cells = weeks.flatMap((week, weekIndex) =>
  week.contributionDays.map((day) => {
    const x = gridX + weekIndex * step;
    const y = gridY + day.weekday * step;
    const fill = day.contributionCount === 0 ? "#161b22" : day.color;
    return `<g><title>${xml(day.date)}: ${day.contributionCount} contributions</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}"/></g>`;
  })
).join("\n");

const dayLabels = [["Mon",1],["Wed",3],["Fri",5]].map(
  ([label, weekday]) =>
    `<text x="74" y="${gridY + Number(weekday) * step + 11}" text-anchor="end" class="day">${label}</text>`
).join("\n");

const wallSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${wallHeight}" viewBox="0 0 ${width} ${wallHeight}" role="img" aria-label="Jease authenticated GitHub contribution wall">
<defs><linearGradient id="panel" x1="0" x2="1"><stop stop-color="#0d1117"/><stop offset="1" stop-color="#111827"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<style>.title{fill:#f0f6fc;font:700 22px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:1px}.sub,.month,.day{fill:#8b949e;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.metric{fill:#f0f6fc;font:700 18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.label{fill:#8b949e;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:1px}</style>
<rect x="1" y="1" width="${width-2}" height="${wallHeight-2}" rx="18" fill="url(#panel)" stroke="#30363d"/>
<circle cx="32" cy="31" r="5" fill="#39d353" filter="url(#glow)"><animate attributeName="opacity" values="1;.25;1" dur="1.8s" repeatCount="indefinite"/></circle>
<text x="48" y="38" class="title">AUTHENTICATED CONTRIBUTION WALL</text>
<text x="${width-28}" y="37" text-anchor="end" class="sub">PUBLIC + PRIVATE · ${updatedAt} UTC</text>
${monthLabels}${dayLabels}${cells}
<line x1="32" y1="220" x2="${width-32}" y2="220" stroke="#30363d"/>
<g transform="translate(55 245)"><text class="metric">${total.toLocaleString("en-US")}</text><text y="21" class="label">CONTRIBUTIONS / 365D</text></g>
<g transform="translate(315 245)"><text class="metric">${activeDays}</text><text y="21" class="label">ACTIVE DAYS</text></g>
<g transform="translate(500 245)"><text class="metric">${peakDay}</text><text y="21" class="label">PEAK / DAY</text></g>
<g transform="translate(650 245)"><text class="metric">${restricted.toLocaleString("en-US")}</text><text y="21" class="label">PRIVATE / RESTRICTED</text></g>
<g transform="translate(875 245)"><text class="metric" fill="#39d353">PRIVATE ON</text><text y="21" class="label">AUTHENTICATED GRAPHQL</text></g>
</svg>`;

const snakeCells = weeks.flatMap((week, weekIndex) =>
  week.contributionDays.map((day) => {
    const x = gridX + weekIndex * step;
    const y = 70 + day.weekday * step;
    const fill = day.contributionCount === 0 ? "#161b22" : day.color;
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}"/>`;
  })
).join("");

const activePoints = weeks.flatMap((week, wi) =>
  week.contributionDays
    .filter((d) => d.contributionCount > 0)
    .map((d) => [gridX + wi * step + cell/2, 70 + d.weekday * step + cell/2])
);
const snakePath = activePoints.length > 1
  ? "M " + activePoints.map(([x,y]) => `${x} ${y}`).join(" L ")
  : "M 100 70 L 1000 160";

const snakeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="220" viewBox="0 0 1100 220" role="img" aria-label="Private-aware animated contribution snake">
<defs><filter id="sg"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="1100" height="220" rx="18" fill="#0d1117" stroke="#30363d"/>
<text x="32" y="36" fill="#f0f6fc" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="18" font-weight="700">PRIVATE-AWARE CONTRIBUTION SNAKE</text>
<text x="1068" y="36" text-anchor="end" fill="#8b949e" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12">SAME AUTHENTICATED DATASET</text>
${snakeCells}
<path id="snakePath" d="${snakePath}" fill="none" stroke="none"/>
<g filter="url(#sg)">
  <circle r="8" fill="#39d353">
    <animateMotion dur="18s" repeatCount="indefinite" rotate="auto"><mpath href="#snakePath"/></animateMotion>
  </circle>
  <circle r="4" fill="#b6f5c2" opacity=".9">
    <animateMotion dur="18s" begin="-0.35s" repeatCount="indefinite"><mpath href="#snakePath"/></animateMotion>
  </circle>
  <circle r="3" fill="#39d353" opacity=".6">
    <animateMotion dur="18s" begin="-0.7s" repeatCount="indefinite"><mpath href="#snakePath"/></animateMotion>
  </circle>
</g>
<text x="32" y="202" fill="#8b949e" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">Animation path is generated from authenticated active contribution days.</text>
</svg>`;

let bars = "";
let legend = "";
let cursorX = 35;
const barY = 207;
const barW = 500;
for (let i = 0; i < languages.length; i++) {
  const lang = languages[i];
  const ratio = lang.size / languageTotal;
  const w = i === languages.length - 1 ? 35 + barW - cursorX : Math.max(2, Math.round(barW * ratio));
  bars += `<rect x="${cursorX}" y="${barY}" width="${w}" height="14" rx="4" fill="${lang.color || "#8b949e"}"/>`;
  cursorX += w;
  const lx = 35 + (i % 2) * 255;
  const ly = 250 + Math.floor(i / 2) * 28;
  legend += `<circle cx="${lx+5}" cy="${ly-5}" r="5" fill="${lang.color || "#8b949e"}"/><text x="${lx+18}" y="${ly}" fill="#c9d1d9" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12">${xml(lang.name)} ${(ratio*100).toFixed(1)}%</text>`;
}

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="385" viewBox="0 0 1100 385" role="img" aria-label="Private-aware GitHub metrics">
<rect x="1" y="1" width="1098" height="383" rx="18" fill="#0d1117" stroke="#30363d"/>
<style>.h{fill:#f0f6fc;font:700 20px ui-monospace,SFMono-Regular,Menlo,monospace}.n{fill:#39d353;font:800 30px ui-monospace,SFMono-Regular,Menlo,monospace}.l{fill:#8b949e;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px}.v{fill:#c9d1d9;font:700 17px ui-monospace,SFMono-Regular,Menlo,monospace}</style>
<text x="35" y="42" class="h">AUTHENTICATED GITHUB SIGNAL</text>
<text x="1065" y="40" text-anchor="end" class="l">PUBLIC + PRIVATE REPOSITORIES</text>
<g transform="translate(35 76)"><text class="n">${collection.totalCommitContributions.toLocaleString("en-US")}</text><text y="23" class="l">COMMITS / 365D</text></g>
<g transform="translate(245 76)"><text class="n">${collection.totalPullRequestContributions.toLocaleString("en-US")}</text><text y="23" class="l">PULL REQUESTS</text></g>
<g transform="translate(455 76)"><text class="n">${collection.totalPullRequestReviewContributions.toLocaleString("en-US")}</text><text y="23" class="l">PR REVIEWS</text></g>
<g transform="translate(665 76)"><text class="n">${collection.totalIssueContributions.toLocaleString("en-US")}</text><text y="23" class="l">ISSUES</text></g>
<g transform="translate(875 76)"><text class="n">${repoTotal}</text><text y="23" class="l">OWNED REPOS</text></g>
<line x1="35" y1="128" x2="1065" y2="128" stroke="#30363d"/>
<text x="35" y="166" class="h">TOP LANGUAGES — OWNED REPOSITORIES</text>
<text x="1065" y="166" text-anchor="end" class="l">${privateRepos} PRIVATE · ${publicRepos} PUBLIC</text>
${bars}
${legend}
<text x="565" y="250" class="v">Private repository language bytes included when PROFILE_PAT has repo scope.</text>
<text x="565" y="278" class="l">No private repository names or source code are rendered into this SVG.</text>
<text x="565" y="322" class="v">TOTAL CONTRIBUTIONS</text>
<text x="875" y="322" class="n">${total.toLocaleString("en-US")}</text>
<text x="565" y="350" class="l">Authenticated GitHub GraphQL · refreshed daily · ${updatedAt} UTC</text>
</svg>`;

await fs.mkdir("assets", { recursive: true });
await Promise.all([
  fs.writeFile(path.join("assets","private-contribution-wall.svg"), wallSvg, "utf8"),
  fs.writeFile(path.join("assets","private-snake.svg"), snakeSvg, "utf8"),
  fs.writeFile(path.join("assets","github-signal.svg"), statsSvg, "utf8"),
]);

console.log(JSON.stringify({
  viewer: viewer.login,
  totalContributions: total,
  restrictedContributionsCount: restricted,
  commits365d: collection.totalCommitContributions,
  privateRepos,
  publicRepos,
  repoTotal,
  topLanguages: languages.map((l) => l.name),
}, null, 2));
