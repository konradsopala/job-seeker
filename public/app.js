const csvFileInput = document.getElementById("csv-file");
const searchTermInput = document.getElementById("search-term");
const searchBtn = document.getElementById("search-btn");
const fileInfo = document.getElementById("file-info");
const fileInfoText = document.getElementById("file-info-text");
const fileDrop = document.getElementById("file-drop");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const progressPct = document.getElementById("progress-pct");
const resultsEl = document.getElementById("results");
const resultsList = document.getElementById("results-list");
const resultCount = document.getElementById("result-count");
const noResults = document.getElementById("no-results");
const errorsEl = document.getElementById("errors");
const errorList = document.getElementById("error-list");
const btnText = document.querySelector(".btn-text");
const btnLoading = document.querySelector(".btn-loading");

let companies = [];

csvFileInput.addEventListener("change", handleFileUpload);
searchTermInput.addEventListener("input", updateSearchButton);
searchBtn.addEventListener("click", startSearch);

// Drag and drop visual feedback
fileDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  fileDrop.classList.add("dragover");
});
fileDrop.addEventListener("dragleave", () => {
  fileDrop.classList.remove("dragover");
});
fileDrop.addEventListener("drop", () => {
  fileDrop.classList.remove("dragover");
});

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    companies = parseCSV(event.target.result);
    fileInfoText.textContent = `${companies.length} companies loaded from ${file.name}`;
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

    const fields = parseCSVLine(line);
    if (fields.length < 2) continue;

    const name = fields[0].trim();
    const url = fields[1].trim();

    if (i === 0 && (url.toLowerCase() === "url" || url.toLowerCase() === "careers_url" || url.toLowerCase() === "link")) {
      continue;
    }

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
  btnText.hidden = true;
  btnLoading.hidden = false;
  resultsList.innerHTML = "";
  errorList.innerHTML = "";
  resultsEl.hidden = false;
  noResults.hidden = true;
  errorsEl.hidden = true;
  progressEl.hidden = false;
  progressFill.style.width = "0%";
  progressPct.textContent = "0%";

  let completed = 0;
  let totalMatches = 0;
  const errors = [];

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
            addResultCard(match.title, company.name, match.url);
          }
        }
      } catch (err) {
        errors.push({ company: company.name, error: err.message });
      }

      completed++;
      const pct = Math.round((completed / companies.length) * 100);
      progressFill.style.width = pct + "%";
      progressPct.textContent = pct + "%";
      progressText.textContent = `Checking ${completed} of ${companies.length} companies...`;
    }
  }

  await Promise.all(workers);

  // Final UI updates
  resultCount.textContent = totalMatches;
  noResults.hidden = totalMatches > 0;
  btnText.hidden = false;
  btnLoading.hidden = true;
  searchBtn.disabled = false;

  if (errors.length > 0) {
    errorsEl.hidden = false;
    for (const err of errors) {
      const li = document.createElement("li");
      li.textContent = `${err.company}: ${err.error}`;
      errorList.appendChild(li);
    }
  }

  progressText.textContent = `Done — ${totalMatches} matching positions found across ${companies.length} companies`;
  progressPct.textContent = "";
}

function addResultCard(title, company, url) {
  const card = document.createElement("div");
  card.className = "result-card";

  const info = document.createElement("div");
  info.className = "result-info";

  const titleEl = document.createElement("div");
  titleEl.className = "result-title";
  titleEl.textContent = title;

  const companyEl = document.createElement("div");
  companyEl.className = "result-company";
  companyEl.textContent = company;

  info.appendChild(titleEl);
  info.appendChild(companyEl);

  const link = document.createElement("a");
  link.className = "result-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View & Apply";

  card.appendChild(info);
  card.appendChild(link);
  resultsList.appendChild(card);
}
