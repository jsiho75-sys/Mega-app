const MEGA_HOME = "https://www.megamillions.com/";
const MEGA_RESULTS = "https://www.megamillions.com/winning-numbers";
const NY_DATA = "https://data.ny.gov/resource/5xaw-6ayf.json";

const ALLOWED_ORIGIN = "*";
const MINIMUM_DRAWS = 100;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          error: "Method not allowed",
          allowed: ["GET", "OPTIONS"]
        },
        405
      );
    }

    try {
      // Get historical drawings from New York State Open Data.
      const draws = await fetchMegaMillionsHistory();

      if (!draws.length) {
        throw new Error(
          "No Mega Millions drawings were returned from the NY Open Data source."
        );
      }

      if (draws.length < MINIMUM_DRAWS) {
        return jsonResponse(
          {
            error: "Mega Millions history retrieval returned too few valid drawings.",
            drawCount: draws.length,
            minimumRequired: MINIMUM_DRAWS,
            historySource: NY_DATA,
            updatedAt: new Date().toISOString()
          },
          502
        );
      }

      // Get current jackpot / next drawing information.
      let currentInfo = {
        jackpot: "",
        cashValue: "",
        nextDrawing: ""
      };

      try {
        const response = await fetch(MEGA_HOME, {
          method: "GET",
          headers: browserHeaders(),
          cf: {
            cacheTtl: 300,
            cacheEverything: true
          }
        });

        if (response.ok) {
          const html = await response.text();
          currentInfo = parseCurrentMegaMillionsInfo(html);
        }
      } catch (error) {
        // Historical data is more important.
        // Continue even if current jackpot parsing fails.
        currentInfo = {
          jackpot: "",
          cashValue: "",
          nextDrawing: ""
        };
      }

      return jsonResponse({
        source: "Mega Millions",
        historySource: "New York State Open Data / New York State Gaming Commission",
        resultsSource: MEGA_RESULTS,

        updatedAt: new Date().toISOString(),

        drawCount: draws.length,

        jackpot: currentInfo.jackpot,
        cashValue: currentInfo.cashValue,
        nextDrawing: currentInfo.nextDrawing,

        ticketCost: "$5 / Play",

        game: {
          whiteBalls: "1-70",
          megaBallCurrent: "1-24",
          ticketCost: 5,
          drawingDays: "Tuesday and Friday",
          drawingTime: "11:00 PM ET"
        },

        draws: draws
      });

    } catch (error) {
      return jsonResponse(
        {
          error: error.message || "Unknown Mega Millions Worker error",
          updatedAt: new Date().toISOString()
        },
        500
      );
    }
  }
}; function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}


function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}


function browserHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language":
      "en-US,en;q=0.9"
  };
} async function fetchMegaMillionsHistory() {

  const url =
    NY_DATA +
    "?$limit=5000" +
    "&$order=draw_date%20DESC";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mega Millions AI Lab",
      "Accept": "application/json"
    },
    cf: {
      cacheTtl: 300,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    throw new Error(
      "NY Open Data returned HTTP " + response.status
    );
  }

  const rows = await response.json();

  if (!Array.isArray(rows)) {
    throw new Error(
      "NY Open Data returned an unexpected response format."
    );
  }

  const draws = [];

  for (const row of rows) {

    if (!row) continue;

    const date = parseDrawDate(row.draw_date);

    if (!date) continue;

    const whiteBalls = parseNumberString(
      row.winning_numbers
    );

    const megaBall = parseSingleNumber(
      row.mega_ball
    );

    if (whiteBalls.length !== 5) continue;

    if (!Number.isInteger(megaBall)) continue;

    if (whiteBalls.some(n => n < 1 || n > 70)) {
      continue;
    }

    // Mega Ball 25 existed in the old game.
    // Therefore we intentionally allow 1-25 historically.
    if (megaBall < 1 || megaBall > 25) {
      continue;
    }

    const sortedWhite = [...whiteBalls].sort(
      (a, b) => a - b
    );

    draws.push({
      date: date,
      numbers: sortedWhite,
      megaBall: megaBall,
      multiplier: normalizeMultiplier(row.multiplier)
    });
  }

  return deduplicateAndSort(draws);
} function parseNumberString(value) {

  if (value === null || value === undefined) {
    return [];
  }

  const matches = String(value).match(/\d+/g);

  if (!matches) {
    return [];
  }

  return matches
    .map(Number)
    .filter(Number.isInteger);
}


function parseSingleNumber(value) {

  const numbers = parseNumberString(value);

  if (!numbers.length) {
    return null;
  }

  return numbers[0];
}


function normalizeMultiplier(value) {

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "-1"
  ) {
    return "";
  }

  const text = String(value).trim();

  if (!text) {
    return "";
  }

  if (/^\d+$/.test(text)) {
    return text + "x";
  }

  if (/^\d+x$/i.test(text)) {
    return text.toLowerCase();
  }

  return text;
}


function parseDrawDate(value) {

  if (!value) {
    return "";
  }

  const text = String(value).trim();

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (!match) {
    return "";
  }

  return (
    match[1] +
    "-" +
    match[2] +
    "-" +
    match[3]
  );
} function deduplicateAndSort(draws) {

  const map = new Map();

  for (const draw of draws) {

    if (!draw || !draw.date) {
      continue;
    }

    const key = draw.date;

    if (!map.has(key)) {
      map.set(key, draw);
    }
  }

  const result = Array.from(map.values());

  result.sort(
    (a, b) =>
      new Date(b.date) - new Date(a.date)
  );

  return result;
} function parseCurrentMegaMillionsInfo(html) {

  const text = cleanHTML(html);

  let jackpot = "";
  let cashValue = "";
  let nextDrawing = "";

  jackpot =
    findMoneyAfterLabel(
      text,
      [
        "Next Estimated Jackpot",
        "Estimated Jackpot"
      ]
    );

  cashValue =
    findMoneyAfterLabel(
      text,
      [
        "Cash Option",
        "Cash Value"
      ]
    );

  const nextMatch = text.match(
    /Next\s+Drawing\s*@?\s*([0-9:apm\s.]+ET)/i
  );

  if (nextMatch) {
    nextDrawing =
      nextMatch[1]
        .replace(/\s+/g, " ")
        .trim();
  }

  return {
    jackpot,
    cashValue,
    nextDrawing
  };
}


function cleanHTML(html) {

  if (!html) {
    return "";
  }

  return String(html)

    .replace(/<script[\s\S]*?<\/script>/gi, " ")

    .replace(/<style[\s\S]*?<\/style>/gi, " ")

    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")

    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")

    .replace(/<[^>]+>/g, " ")

    .replace(/&nbsp;/gi, " ")

    .replace(/&amp;/gi, "&")

    .replace(/&quot;/gi, '"')

    .replace(/&#39;/gi, "'")

    .replace(/&lt;/gi, "<")

    .replace(/&gt;/gi, ">")

    .replace(/\s+/g, " ")

    .trim();
}


function findMoneyAfterLabel(text, labels) {

  for (const label of labels) {

    const escaped =
      label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(
      escaped +
      "\\s*:?\\s*(\\$[0-9,.]+\\s*(?:million|billion|M|B)?)",
      "i"
    );

    const match = text.match(regex);

    if (match) {
      return match[1].trim();
    }
  }

  // Fallback: look for a dollar amount followed
  // by Million/Billion.
  const fallback =
    text.match(
      /\$[0-9,.]+\s*(?:million|billion|M|B)/i
    );

  return fallback
    ? fallback[0].trim()
    : "";
}
