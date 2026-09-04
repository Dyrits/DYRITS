import { readFile, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME;
const token = process.env.GITHUB_TOKEN;
const version = process.env.METRICS_VERSION ?? Date.now().toString();

if (!username || !token) {
  throw new Error("GITHUB_USERNAME and GITHUB_TOKEN are required.");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function request(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed with ${response.status} for ${path}.`);
  }
  return response.json();
}

async function getRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`/users/${username}/repos?type=owner&sort=updated&per_page=100&page=${page}`);
    repositories.push(...batch.filter((repository) => !repository.fork && !repository.disabled));
    if (batch.length < 100) break;
  }
  return repositories;
}

async function getLanguageTotals(repositories) {
  const totals = new Map();
  for (let index = 0; index < repositories.length; index += 10) {
    const batch = repositories.slice(index, index + 10);
    const results = await Promise.all(batch.map((repository) => request(`/repos/${repository.full_name}/languages`)));
    for (const languages of results) {
      for (const [language, bytes] of Object.entries(languages)) {
        totals.set(language, (totals.get(language) ?? 0) + bytes);
      }
    }
  }
  return totals;
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function render(totals, repositoryCount) {
  const colors = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572A5",
    Java: "#b07219",
    HTML: "#e34c26",
    CSS: "#663399",
    Shell: "#89e051",
    Kotlin: "#A97BFF",
    Swift: "#F05138",
    PHP: "#4F5D95",
    Go: "#00ADD8",
    Rust: "#dea584",
    Dart: "#00B4AB",
    C: "#555555",
    "C++": "#f34b7d",
    "C#": "#178600",
  };
  const all = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const totalBytes = all.reduce((sum, [, bytes]) => sum + bytes, 0);
  const top = all.slice(0, 8);
  const rows = top.map(([language, bytes], index) => {
    const percentage = totalBytes ? (bytes / totalBytes) * 100 : 0;
    const y = 118 + index * 36;
    const width = Math.max(2, (percentage / 100) * 500);
    const color = colors[language] ?? "#8b949e";
    return `
  <circle cx="28" cy="${y - 5}" r="6" fill="${color}" />
  <text x="44" y="${y}" class="label">${escapeXml(language)}</text>
  <rect x="210" y="${y - 16}" width="500" height="12" rx="6" fill="#21262d" />
  <rect x="210" y="${y - 16}" width="${width.toFixed(1)}" height="12" rx="6" fill="${color}" />
  <text x="770" y="${y}" class="value" text-anchor="end">${percentage.toFixed(1)}%</text>`;
  }).join("");
  const height = 140 + top.length * 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-labelledby="title description">
  <title id="title">Most used languages across ${repositoryCount} public repositories</title>
  <desc id="description">Language distribution calculated from GitHub's reported byte counts for every public, owned, non-fork repository.</desc>
  <style>
    .heading { fill: #58a6ff; font: 600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .caption { fill: #8b949e; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { fill: #c9d1d9; font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .value { fill: #8b949e; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect width="800" height="${height}" rx="12" fill="#0d1117" />
  <text x="24" y="42" class="heading">Most used languages</text>
  <text x="24" y="70" class="caption">All ${repositoryCount} public, owned, non-fork repositories · ${all.length} detected languages</text>${rows}
</svg>`;
}

const repositories = await getRepositories();
const totals = await getLanguageTotals(repositories);
await writeFile("language-metrics.svg", render(totals, repositories.length));
const readme = await readFile("README.md", "utf8");
const versionedReadme = readme.replace(/(src="\.\/(?:github|language)-metrics\.svg)(?:\?v=[^"]*)?"/g, `$1?v=${version}"`);
await writeFile("README.md", versionedReadme);
console.log(`Generated language metrics from ${repositories.length} repositories and ${totals.size} languages.`);
