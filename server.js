const express = require("express");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/scrape", async (req, res) => {
  const { url, searchTerm } = req.body;

  if (!url || !searchTerm) {
    return res.status(400).json({ error: "url and searchTerm are required" });
  }

  try {
    const html = await fetchPage(url);
    const matches = extractMatchingJobs(html, url, searchTerm);
    res.json({ matches });
  } catch (err) {
    res.json({ matches: [], error: err.message });
  }
});

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractMatchingJobs(html, baseUrl, searchTerm) {
  const $ = cheerio.load(html);
  const keywords = searchTerm
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const matches = [];
  const seen = new Set();

  // Extract all links and check their text against the search term
  $("a").each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const href = $el.attr("href");

    if (!text || !href || text.length < 3) return;

    const textLower = text.toLowerCase();
    if (!isMatch(textLower, keywords)) return;

    const absoluteUrl = resolveUrl(href, baseUrl);
    if (!absoluteUrl) return;

    const key = `${text}|${absoluteUrl}`;
    if (seen.has(key)) return;
    seen.add(key);

    matches.push({ title: text, url: absoluteUrl });
  });

  // Extract jobs from embedded JSON data (Ashby, Greenhouse, Lever, etc.)
  // Many career pages are JS-rendered and embed job data in script tags
  extractJobsFromJSON(html, baseUrl, keywords, seen, matches);

  // Also check list items, table rows, and other containers that might
  // contain job titles with a nearby link
  const containers = "li, tr, article, [class*='job'], [class*='position'], [class*='opening'], [class*='career'], [data-job], [data-position]";
  $(containers).each((_, el) => {
    const $el = $(el);
    const fullText = $el.text().trim().replace(/\s+/g, " ");

    if (!fullText || fullText.length < 3) return;

    // The full container text must match
    if (!isMatch(fullText.toLowerCase(), keywords)) return;

    // Find links inside this container
    $el.find("a").each((_, linkEl) => {
      const $link = $(linkEl);
      const linkText = $link.text().trim().replace(/\s+/g, " ");
      const href = $link.attr("href");

      if (!linkText || !href || linkText.length < 3) return;

      // The link text itself must also match to avoid false positives
      if (!isMatch(linkText.toLowerCase(), keywords)) return;

      const absoluteUrl = resolveUrl(href, baseUrl);
      if (!absoluteUrl) return;

      const key = `${linkText}|${absoluteUrl}`;
      if (seen.has(key)) return;
      seen.add(key);

      matches.push({ title: linkText.substring(0, 200), url: absoluteUrl });
    });
  });

  return matches;
}

function extractJobsFromJSON(html, baseUrl, keywords, seen, matches) {
  // Many career pages (Ashby, Greenhouse, Lever) embed job data as JSON
  // in script tags. Extract top-level JSON objects from the raw HTML.
  extractJSONBlobs(html, (obj) => {
    findJobsInObject(obj, baseUrl, keywords, seen, matches);
  });
}

function extractJSONBlobs(html, callback) {
  // Find positions where a top-level JSON object starts after an assignment
  // Patterns: window.__appData = {...}, var jobs = [...], etc.
  const startPatterns = /=\s*(\{|\[)/g;
  let pm;

  while ((pm = startPatterns.exec(html)) !== null) {
    const openChar = pm[1];
    const closeChar = openChar === "{" ? "}" : "]";
    const startPos = pm.index + pm[0].length - 1; // position of { or [

    // Use a brace-counting approach to find the matching close
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startPos; i < html.length && i < startPos + 500000; i++) {
      const ch = html[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          const jsonStr = html.slice(startPos, i + 1);
          if (jsonStr.includes('"title"') && jsonStr.length > 50) {
            try {
              const data = JSON.parse(jsonStr);
              callback(data);
            } catch {
              // skip
            }
          }
          break;
        }
      }
    }
  }
}

function findJobsInObject(obj, baseUrl, keywords, seen, matches) {
  if (!obj || typeof obj !== "object") return;

  // Check if this object looks like a job posting
  if (obj.title && typeof obj.title === "string") {
    const titleLower = obj.title.toLowerCase();
    if (isMatch(titleLower, keywords)) {
      // Try to find a URL for this job
      const jobUrl =
        obj.jobUrl ||
        obj.url ||
        obj.applyUrl ||
        obj.hostedUrl ||
        obj.absolute_url ||
        obj.link ||
        null;

      // For Ashby/Lever pages, construct URL from id
      const id = obj.id || obj.jobId;
      const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
      const resolvedUrl = jobUrl
        ? resolveUrl(jobUrl, baseWithSlash)
        : id
          ? resolveUrl(id, baseWithSlash)
          : baseUrl;

      if (resolvedUrl) {
        const key = `${obj.title}|${resolvedUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ title: obj.title, url: resolvedUrl });
        }
      }
    }
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findJobsInObject(item, baseUrl, keywords, seen, matches);
    }
  } else {
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        findJobsInObject(value, baseUrl, keywords, seen, matches);
      }
    }
  }
}

function isMatch(text, keywords) {
  // Check if the text contains enough keywords to be a relevant match
  // Require all keywords to be present as substrings
  return keywords.every((kw) => text.includes(kw));
}

function resolveUrl(href, baseUrl) {
  try {
    // Skip non-http links
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:") ||
      href === "#"
    ) {
      return null;
    }
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`Job Seeker running at http://localhost:${PORT}`);
});
