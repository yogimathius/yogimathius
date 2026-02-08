import { readFile, writeFile } from "node:fs/promises";

const README_PATH = "README.md";
const START_MARKER = "<!--START_SECTION:latest_writing-->";
const END_MARKER = "<!--END_SECTION:latest_writing-->";

const SOURCE_REPO = process.env.WRITING_SOURCE_REPO || "yogimathius/remix-portfolio";
const SOURCE_DIR = process.env.WRITING_SOURCE_DIR || "docs";
const SOURCE_BRANCH = process.env.WRITING_SOURCE_BRANCH || "main";
const MAX_ITEMS = Number(process.env.WRITING_MAX_ITEMS || "5");
const GH_TOKEN = process.env.GH_TOKEN || "";

function headers() {
  const base = {
    Accept: "application/vnd.github+json",
    "User-Agent": "yogimathius-readme-updater",
  };

  if (GH_TOKEN) {
    return {
      ...base,
      Authorization: `Bearer ${GH_TOKEN}`,
    };
  }

  return base;
}

function toTitle(filename) {
  const base = filename.replace(/\.md$/i, "");
  const acronymMap = {
    ai: "AI",
    mcp: "MCP",
    wasm: "Wasm",
  };

  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (acronymMap[lower]) return acronymMap[lower];
      if (/^\d+$/.test(part)) return part;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function getWritingEntries() {
  const contentsUrl = `https://api.github.com/repos/${SOURCE_REPO}/contents/${SOURCE_DIR}?ref=${encodeURIComponent(SOURCE_BRANCH)}`;
  const contents = await fetchJson(contentsUrl);

  if (!Array.isArray(contents)) {
    return [];
  }

  const markdownFiles = contents
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .slice(0, 40);

  const entries = await Promise.all(
    markdownFiles.map(async (file) => {
      const commitUrl = `https://api.github.com/repos/${SOURCE_REPO}/commits?path=${encodeURIComponent(file.path)}&per_page=1&sha=${encodeURIComponent(SOURCE_BRANCH)}`;
      let date = null;

      try {
        const commits = await fetchJson(commitUrl);
        if (Array.isArray(commits) && commits[0]?.commit?.author?.date) {
          date = commits[0].commit.author.date;
        }
      } catch {
        // Keep null date and still include the file as a fallback entry.
      }

      return {
        title: toTitle(file.name),
        url: file.html_url,
        isoDate: date,
      };
    })
  );

  const sorted = entries
    .sort((a, b) => {
      if (!a.isoDate && !b.isoDate) return a.title.localeCompare(b.title);
      if (!a.isoDate) return 1;
      if (!b.isoDate) return -1;
      return new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime();
    })
    .slice(0, MAX_ITEMS);

  return sorted;
}

function renderWritingBlock(entries) {
  if (!entries.length) {
    return [
      "- No recent writing found. The section will auto-update on the next successful run.",
    ].join("\n");
  }

  return entries
    .map((entry) => {
      const dateLabel = entry.isoDate ? new Date(entry.isoDate).toISOString().slice(0, 10) : "date n/a";
      return `- ${dateLabel} - [${entry.title}](${entry.url})`;
    })
    .join("\n");
}

function replaceSection(readme, block) {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Latest writing markers not found in README.md");
  }

  const before = readme.slice(0, start + START_MARKER.length);
  const after = readme.slice(end);
  return `${before}\n${block}\n${after}`;
}

async function main() {
  const readme = await readFile(README_PATH, "utf8");
  let entries = [];
  let hadSourceError = false;

  try {
    entries = await getWritingEntries();
  } catch (error) {
    hadSourceError = true;
    console.warn("Unable to fetch writing entries:", error.message);
  }

  if (hadSourceError) {
    console.log("Skipping README update because writing source is unavailable.");
    return;
  }

  const block = renderWritingBlock(entries);
  const next = replaceSection(readme, block);

  if (next !== readme) {
    await writeFile(README_PATH, next, "utf8");
    console.log(`Updated README latest writing section with ${entries.length} item(s).`);
  } else {
    console.log("Latest writing section unchanged.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
