const csvFileInput = document.getElementById("csv-file");
const searchTermInput = document.getElementById("search-term");
const searchBtn = document.getElementById("search-btn");
const fileInfo = document.getElementById("file-info");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const resultsEl = document.getElementById("results");
const resultsBody = document.getElementById("results-body");
const resultCount = document.getElementById("result-count");
const noResults = document.getElementById("no-results");
const errorsEl = document.getElementById("errors");
const errorList = document.getElementById("error-list");

let companies = [];

csvFileInput.addEventListener("change", handleFileUpload);
searchTermInput.addEventListener("input", updateSearchButton);
searchBtn.addEventListener("click", startSearch);

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    companies = parseCSV(event.target.result);
    fileInfo.textContent = `Loaded ${companies.length} companies`;
    fileInfo.hidden = false;
    updateSearchButton();
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV respecting quoted fields
    const fields = parseCSVLine(line);
    if (fields.length < 2) continue;

    const name = fields[0].trim();
    const url = fields[1].trim();

    // Skip header row
    if (i === 0 && (url.toLowerCase() === "url" || url.toLowerCase() === "careers_url" || url.toLowerCase() === "link")) {
      continue;
    }

    // Validate URL
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;

    result.push({ name, url });
  }

  return result;
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function updateSearchButton() {
  searchBtn.disabled = companies.length === 0 || !searchTermInput.value.trim();
}

async function startSearch() {
  const searchTerm = searchTermInput.value.trim();
  if (!searchTerm || companies.length === 0) return;

  // Reset UI
  searchBtn.disabled = true;
  resultsBody.innerHTML = "";
  errorList.innerHTML = "";
  resultsEl.hidden = false;
  noResults.hidden = true;
  errorsEl.hidden = true;
  progressEl.hidden = false;
  progressFill.style.width = "0%";

  let completed = 0;
  let totalMatches = 0;
  const errors = [];

  // Process companies with concurrency limit
  const CONCURRENCY = 3;
  const queue = [...companies];
  const workers = [];

  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    workers.push(processQueue());
  }

  async function processQueue() {
    while (queue.length > 0) {
      const company = queue.shift();
      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: company.url, searchTerm }),
        });

        const data = await res.json();

        if (data.error) {
          errors.push({ company: company.name, error: data.error });
        }

        if (data.matches && data.matches.length > 0) {
          for (const match of data.matches) {
            totalMatches++;
            addResultRow(match.title, company.name, match.url);
          }
        }
      } catch (err) {
        errors.push({ company: company.name, error: err.message });
      }

      completed++;
      const pct = Math.round((completed / companies.length) * 100);
      progressFill.style.width = pct + "%";
      progressText.textContent = `${completed} / ${companies.length} companies checked`;
    }
  }

  await Promise.all(workers);

  // Final UI updates
  resultCount.textContent = `(${totalMatches})`;
  noResults.hidden = totalMatches > 0;
  searchBtn.disabled = false;

  if (errors.length > 0) {
    errorsEl.hidden = false;
    for (const err of errors) {
      const li = document.createElement("li");
      li.textContent = `${err.company}: ${err.error}`;
      errorList.appendChild(li);
    }
  }

  progressText.textContent = `Done. ${totalMatches} matching positions found across ${companies.length} companies.`;
}

function addResultRow(title, company, url) {
  const tr = document.createElement("tr");

  const tdTitle = document.createElement("td");
  tdTitle.textContent = title;

  const tdCompany = document.createElement("td");
  tdCompany.textContent = company;

  const tdLink = document.createElement("td");
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Apply";
  tdLink.appendChild(a);

  tr.appendChild(tdTitle);
  tr.appendChild(tdCompany);
  tr.appendChild(tdLink);
  resultsBody.appendChild(tr);
}
