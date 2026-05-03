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

// delay to avoid rate limit
const delay = ms => new Promise(res => setTimeout(res, ms));

// clean emails
function cleanEmails(input) {
  let emails = [];

  if (typeof input === "string") {
    emails = input.split("\n");
  } else {
    emails = input;
  }

  return [...new Set(
    emails
      .map(e => e.trim())
      .map(e => e.replace(/"/g, ""))
      .filter(e => e !== "")
  )];
}

// ✅ BULK CHECK
app.post("/bulk-check", async (req, res) => {
  try {
    let { emails } = req.body;

    emails = cleanEmails(emails);

    const validEmails = emails.filter(e =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    );

    const invalidEmails = emails.filter(e =>
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    );

    const results = [];

    for (const email of validEmails) {
      const response = await axios.get(
        `https://api.debounce.io/v1/?api=${API_KEY}&email=${email}`
      );

      results.push(response.data);

      await delay(300);
    }

    res.json({
      results,
      invalidEmails
    });

  } catch (err) {
    res.status(500).json({ error: "Bulk check failed" });
  }
});

// ✅ CSV DOWNLOAD
app.post("/download-csv", (req, res) => {
  try {
    const data = req.body;

    const formatted = data.map(item => ({
      email: item.debounce.email,
      result: item.debounce.result,
      reason: item.debounce.reason,
      code: item.debounce.code,
      free_email: item.debounce.free_email,
      role: item.debounce.role
    }));

    const parser = new Parser();
    const csv = parser.parse(formatted);

    res.header("Content-Type", "text/csv");
    res.attachment("emails.csv");
    res.send(csv);

  } catch {
    res.status(500).json({ error: "CSV failed" });
  }
});

// ✅ JSON DOWNLOAD
app.post("/download-json", (req, res) => {
  res.header("Content-Type", "application/json");
  res.attachment("emails.json");
  res.send(JSON.stringify(req.body, null, 2));
});

// start server
app.listen(5000, () => {
  console.log("Server running: http://localhost:5000");
});