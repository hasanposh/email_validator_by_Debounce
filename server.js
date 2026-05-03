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
  timeout: 8000
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
app.post("/bulk-check", async (req, res) => {
  try {
    let { emails } = req.body;

    emails = cleanEmails(emails);

    const validEmails = emails.filter(isValidEmail);
    const invalidEmails = emails.filter(e => !isValidEmail(e));

    if (validEmails.length === 0) {
      return res.json({
        results: [],
        invalidEmails
      });
    }

    // ⚡ process with concurrency (FAST but controlled)
    const results = await processBatch(validEmails, 5);

    res.json({
      results,
      invalidEmails
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Bulk check failed",
      details: err.message
    });
  }
});

// ✅ CSV DOWNLOAD
app.post("/download-csv", (req, res) => {
  try {
    const formatted = req.body.map(item => ({
      email: item?.debounce?.email || "",
      result: item?.debounce?.result || "",
      reason: item?.debounce?.reason || "",
      code: item?.debounce?.code || "",
      free_email: item?.debounce?.free_email || "",
      role: item?.debounce?.role || ""
    }));

    const parser = new Parser();
    const csv = parser.parse(formatted);

    res.header("Content-Type", "text/csv");
    res.attachment("emails.csv");
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