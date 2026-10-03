import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.PROFILE_PAT;
const expectedOwner = process.env.PROFILE_OWNER || process.env.GITHUB_REPOSITORY_OWNER;

if (!token) {
  throw new Error(
    "Missing PROFILE_PAT. Add a GitHub Actions repository secret named PROFILE_PAT with classic PAT scope: read:user."
  );
}

const to = new Date();
const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

const query = `
  query ProfileContributions($from: DateTime!, $to: DateTime!) {
    viewer {
      login
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          months {
            firstDay
            name
            totalWeeks
            year
          }
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

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "jease0502-profile-contribution-wall",
  },
  body: JSON.stringify({
    query,
    variables: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`GitHub GraphQL HTTP ${response.status}: ${body}`);
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(
    "GitHub GraphQL error: " + payload.errors.map((e) => e.message).join("; ")
  );
}

const viewer = payload.data?.viewer;
if (!viewer) {
  throw new Error("GitHub GraphQL returned no viewer data.");
}

if (
  expectedOwner &&
  viewer.login.toLowerCase() !== expectedOwner.toLowerCase()
) {
  throw new Error(
    `PROFILE_PAT belongs to @${viewer.login}, but this profile repository belongs to @${expectedOwner}.`
  );
}

const collection = viewer.contributionsCollection;
const calendar = collection.contributionCalendar;
const weeks = calendar.weeks;
const days = weeks.flatMap((week) => week.contributionDays);

if (!weeks.length || !days.length) {
  throw new Error("No contribution calendar data returned.");
}

const activeDays = days.filter((day) => day.contributionCount > 0).length;
const peakDay = Math.max(...days.map((day) => day.contributionCount));
const total = calendar.totalContributions;
const restricted = collection.restrictedContributionsCount;

const width = 1100;
const height = 286;
const gridX = 100;
const gridY = 86;
const cell = 13;
const gap = 4;
const step = cell + gap;

const xml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const weekEnd = (week) => {
  const list = week.contributionDays;
  return list[list.length - 1]?.date || week.firstDay;
};

const monthLabels = calendar.months
  .map((month) => {
    let index = weeks.findIndex(
      (week) => month.firstDay >= week.firstDay && month.firstDay <= weekEnd(week)
    );
    if (index < 0) {
      index = weeks.findIndex((week) => week.firstDay >= month.firstDay);
    }
    if (index < 0) return "";
    const x = gridX + index * step;
    return `<text x="${x}" y="67" class="month">${xml(month.name.slice(0, 3))}</text>`;
  })
  .filter(Boolean)
  .join("\n");

const cells = weeks
  .flatMap((week, weekIndex) =>
    week.contributionDays.map((day) => {
      const x = gridX + weekIndex * step;
      const y = gridY + day.weekday * step;
      const count = day.contributionCount;
      const fill = count === 0 ? "#161b22" : day.color;
      const opacity = count === 0 ? "1" : "1";
      return `
        <g>
          <title>${xml(day.date)}: ${count} contribution${count === 1 ? "" : "s"}</title>
          <rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3"
                fill="${fill}" opacity="${opacity}" />
        </g>`;
    })
  )
  .join("\n");

const dayLabels = [
  ["Mon", 1],
  ["Wed", 3],
  ["Fri", 5],
]
  .map(
    ([label, weekday]) =>
      `<text x="74" y="${gridY + Number(weekday) * step + 11}" text-anchor="end" class="day">${label}</text>`
  )
  .join("\n");

const privateStatus =
  restricted > 0
    ? `${restricted.toLocaleString("en-US")} private/restricted contributions included`
    : "Authenticated GraphQL contribution calendar";

const updatedAt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(to);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Jease GitHub contribution wall">
  <defs>
    <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0d1117"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
    <filter id="softGlow">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <style>
    .title { fill:#f0f6fc; font:700 22px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; letter-spacing:1px; }
    .sub { fill:#8b949e; font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .month,.day { fill:#8b949e; font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .metric { fill:#f0f6fc; font:700 18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .metricLabel { fill:#8b949e; font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; letter-spacing:1px; }
  </style>

  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="18" fill="url(#panel)" stroke="#30363d"/>

  <circle cx="32" cy="31" r="5" fill="#39d353" filter="url(#softGlow)">
    <animate attributeName="opacity" values="1;.25;1" dur="1.8s" repeatCount="indefinite"/>
  </circle>
  <text x="48" y="38" class="title">CONTRIBUTION WALL</text>
  <text x="${width - 28}" y="37" text-anchor="end" class="sub">PUBLIC + PRIVATE COUNTS · UPDATED ${updatedAt} UTC</text>

  ${monthLabels}
  ${dayLabels}
  ${cells}

  <line x1="32" y1="220" x2="${width - 32}" y2="220" stroke="#30363d"/>

  <g transform="translate(55 245)">
    <text class="metric">${total.toLocaleString("en-US")}</text>
    <text y="21" class="metricLabel">CONTRIBUTIONS / 365D</text>
  </g>

  <g transform="translate(315 245)">
    <text class="metric">${activeDays.toLocaleString("en-US")}</text>
    <text y="21" class="metricLabel">ACTIVE DAYS</text>
  </g>

  <g transform="translate(515 245)">
    <text class="metric">${peakDay.toLocaleString("en-US")}</text>
    <text y="21" class="metricLabel">PEAK / DAY</text>
  </g>

  <g transform="translate(705 245)">
    <text class="metric" fill="#39d353">PRIVATE ENABLED</text>
    <text y="21" class="metricLabel">${xml(privateStatus)}</text>
  </g>
</svg>
`;

const outPath = path.join("assets", "contribution-wall.svg");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, svg, "utf8");

console.log(
  JSON.stringify(
    {
      viewer: viewer.login,
      totalContributions: total,
      activeDays,
      peakDay,
      restrictedContributionsCount: restricted,
      from: from.toISOString(),
      to: to.toISOString(),
      output: outPath,
    },
    null,
    2
  )
);
