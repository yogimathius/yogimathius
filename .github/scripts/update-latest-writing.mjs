import { readFile, writeFile } from "node:fs/promises";

const README_PATH = "README.md";
const START_MARKER = "<!--START_SECTION:latest_writing-->";
const END_MARKER = "<!--END_SECTION:latest_writing-->";

const WRITING_FEED_URL = process.env.WRITING_FEED_URL || "https://yogimathius.dev/feed.json";
const MAX_ITEMS = Number(process.env.WRITING_MAX_ITEMS || "5");

function requestHeaders() {
  return {
    Accept: "application/feed+json, application/json;q=0.9",
    "User-Agent": "yogimathius-readme-updater",
  };
}

async function fetchFeedEntries() {
  const response = await fetch(WRITING_FEED_URL, { headers: requestHeaders() });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "unknown";
  const raw = await response.text();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`Feed response is not valid JSON (content-type: ${contentType})`);
  }

  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("Feed payload is missing an items array");
  }

  const entries = payload.items
    .map((item) => {
      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled";
      const url =
        typeof item.url === "string"
          ? item.url
          : typeof item.external_url === "string"
            ? item.external_url
            : "";
      const isoDate =
        typeof item.date_published === "string"
          ? item.date_published
          : typeof item.date_modified === "string"
            ? item.date_modified
            : null;

      return {
        title,
        url,
        isoDate,
      };
    })
    .filter((entry) => entry.url)
    .sort((a, b) => {
      if (!a.isoDate && !b.isoDate) return a.title.localeCompare(b.title);
      if (!a.isoDate) return 1;
      if (!b.isoDate) return -1;
      return new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime();
    })
    .slice(0, MAX_ITEMS);

  return entries;
}

function renderWritingBlock(entries) {
  if (!entries.length) {
    return "- No recent writing found in the public feed.";
  }

  return entries
    .map((entry) => {
      const dateLabel = entry.isoDate
        ? new Date(entry.isoDate).toISOString().slice(0, 10)
        : "date n/a";

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

  let entries;
  try {
    entries = await fetchFeedEntries();
  } catch (error) {
    throw new Error(
      `Unable to refresh latest writing from ${WRITING_FEED_URL}. ${error.message}`
    );
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
