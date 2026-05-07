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

if (!API_KEY) throw new Error("Missing API_KEY_VALUE in .env file");

const api = axios.create({
  baseURL: "https://api.debounce.io/v1/",
  timeout: 8000, 
});

// ✅ Utility: Clean and Dedup emails
function cleanEmails(input) {
  let emails = typeof input === "string" ? input.split("\n") : input;
  return [...new Set(emails.map(e => e.trim().replace(/"/g, "")).filter(Boolean))];
}

// ✅ Utility: Email Format Validator
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ✅ ADAPTIVE RETRY (Handles 429 Rate Limits & Timeouts)
// ✅ 1. Increased Patience & Longer Cooling
// ✅ 1. Faster Timeout Strategy for Stubborn Servers
async function fetchWithRetry(email, retries = 1) { // Reduced retries to 1 for timeouts
  try {
    const res = await api.get("/", {
      params: { api: API_KEY, email },
      timeout: 15000 // 15 seconds is the "sweet spot"
    });
    return res.data;
  } catch (err) {
    const isRateLimit = err.response && err.response.status === 429;
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');

    // If it's a Rate Limit, we still want to wait and retry
    if (isRateLimit && retries > 0) {
      console.log(`⚠️ Rate Limit on ${email}. Sleeping 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      return fetchWithRetry(email, retries - 1);
    }

    // If it's a Timeout, we label it and move on to save you time
    return {
      debounce: {
        email,
        result: "Risky",
        reason: isTimeout ? "Server Unresponsive" : "API Error",
        country: "N/A",
        code: "timeout"
      }
    };
  }
}

// ✅ 2. Pure Sequential Processing (One-at-a-time)
// This is the safest way to handle high-value leads without getting blocked.
// ✅ 2. Sequential Processing with "Cooling"
async function processBatch(emails) {
  const results = [];
  for (const email of emails) {
    console.log(`Checking: ${email}...`);
    const data = await fetchWithRetry(email);
    results.push(data);
    // 300ms gap keeps the connection "warm" without triggering limits
    await new Promise(r => setTimeout(r, 300)); 
  }
  return results;
}

// ✅ Concurrency Controller
async function processBatch(emails, limit = 2) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < emails.length) {
      const current = index++;
      results[current] = await fetchWithRetry(emails[current]);
    }
  }
  const workers = Array(limit).fill(null).map(worker);
  await Promise.all(workers);
  return results;
}

// ✅ MAIN API ROUTE
// ✅ 3. Updated Bulk Check Route (Simplified)
// ✅ 3. Updated Mapping logic
app.post("/bulk-check", async (req, res) => {
  try {
    let { emails } = req.body;
    emails = cleanEmails(emails);
    const validEmails = emails.filter(isValidEmail);

    if (validEmails.length === 0) return res.json({ results: [], invalidEmails: [] });

    const rawResults = await processBatch(validEmails);

    const flattenedResults = rawResults.map(item => {
      const data = item.debounce || item;
      return {
        ...data,
        email: data.email || "Unknown",
        result: data.result || "error",
        country: data.country || data.location || "N/A"
      };
    });

    res.json({ results: flattenedResults, invalidEmails: emails.filter(e => !isValidEmail(e)) });
  } catch (err) {
    res.status(500).json({ error: "Check failed" });
  }
});

// ✅ DOWNLOADS
app.post("/download-csv", (req, res) => {
  try {
    const parser = new Parser();
    res.header("Content-Type", "text/csv").attachment("emails.csv").send(parser.parse(req.body));
  } catch (err) { res.status(500).send("CSV Error"); }
});

app.post("/download-json", (req, res) => {
  res.header("Content-Type", "application/json").attachment("emails.json").send(JSON.stringify(req.body, null, 2));
});

app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));