require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Parser } = require("json2csv");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const API_KEY = process.env.API_KEY_VALUE;
const PORT = process.env.PORT || 5000;

// ✅ Fail fast if API key missing
if (!API_KEY) {
  throw new Error("Missing API_KEY_VALUE in environment variables");
}

// ✅ Axios instance (better control)
const api = axios.create({
  baseURL: "https://api.debounce.io/v1/",
  timeout: 15000
});

// ✅ Email cleaner
function cleanEmails(input) {
  let emails = typeof input === "string" ? input.split("\n") : input;

  return [...new Set(
    emails
      .map(e => e.trim().replace(/"/g, ""))
      .filter(Boolean)
  )];
}

// ✅ Email validator
const isValidEmail = (e) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ✅ Retry wrapper
async function fetchWithRetry(email, retries = 2) {
  try {
    const res = await api.get("/", {
      params: {
        api: API_KEY,
        email
      }
    });
    return res.data;

  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchWithRetry(email, retries - 1);
    }

    return {
      debounce: {
        email,
        result: "error",
        reason: err.message,
        code: null,
        free_email: null,
        role: null
      }
    };
  }
}

// ✅ Concurrency controller (important)
async function processBatch(emails, limit = 5) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < emails.length) {
      const current = index++;
      const email = emails[current];

      const data = await fetchWithRetry(email);
      results[current] = data;
    }
  }

  const workers = Array(limit).fill(null).map(worker);
  await Promise.all(workers);

  return results;
}

// ✅ BULK CHECK
// ✅ 1. UPDATE BULK-CHECK (Flatten the object)
app.post("/bulk-check", async (req, res) => {
  try {
    let { emails } = req.body;
    emails = cleanEmails(emails);
    const validEmails = emails.filter(isValidEmail);

    const rawResults = await processBatch(validEmails, 5);

    // Flattening ensures "country", "location", etc. are preserved at the top level
    const flattenedResults = rawResults.map(item => {
      return item.debounce ? { ...item.debounce } : { email: "Error", result: "api_fail" };
    });

    res.json({ results: flattenedResults, invalidEmails: emails.filter(e => !isValidEmail(e)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ 2. UPDATE CSV DOWNLOAD (Let the parser handle headers)
app.post("/download-csv", (req, res) => {
  try {
    const data = req.body; // Expecting the flattened array from bulk-check

    const parser = new Parser(); 
    const csv = parser.parse(data); // This automatically creates columns for EVERY field (including Brazil/Country)

    res.header("Content-Type", "text/csv");
    res.attachment("verified_emails.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: "CSV generation failed" });
  }
});

// ✅ JSON DOWNLOAD
app.post("/download-json", (req, res) => {
  res.header("Content-Type", "application/json");
  res.attachment("emails.json");
  res.send(JSON.stringify(req.body, null, 2));
});

// ✅ HEALTH CHECK (useful in production)
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});