// One place for the Gemini REST call, shared by summaries and classification.
// Both are optional and fail open: the build never depends on this module succeeding.

export const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // the API itself named this when 2.5-flash-lite returned 404 "no longer available to new users" (2026-10-03)

// Stop the whole run: the key is wrong or the quota is spent, so more calls would only fail.
export class HaltGemini extends Error {}

// The free tier allows 15 requests a minute (checked in AI Studio, 2026-10-04). Every call in the build goes
// through generate(), so pacing here covers classification, grouping and summaries together: calls start at
// least minIntervalMs apart (default 5 s, 12 a minute).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextStart = 0;
async function pace(ms) {
  const now = Date.now();
  const wait = Math.max(0, nextStart - now);
  nextStart = Math.max(now, nextStart) + ms;
  if (wait > 0) await sleep(wait);
}

// Google's error body is {"error": {"code", "message", "status", "details"}}. Keep a short, key-free excerpt so a
// failure can be diagnosed from the build log, and the suggested retry delay ("RetryInfo", e.g. "12s") if any.
async function errorInfo(res, apiKey) {
  try {
    const e = (await res.json())?.error;
    const text = `${e?.status ?? ""} ${e?.message ?? ""}`.split(apiKey).join("***").replace(/\s+/g, " ").trim().slice(0, 200);
    const retry = (e?.details ?? []).find((d) => String(d?.["@type"]).endsWith("RetryInfo"))?.retryDelay;
    const seconds = Number.parseFloat(retry);
    return { detail: text ? ` ${text}` : "", retryMs: Number.isFinite(seconds) ? seconds * 1000 : null };
  } catch {
    return { detail: "", retryMs: null };
  }
}

const envNumber = (name, fallback) => (process.env[name] !== undefined && process.env[name] !== "" ? Number(process.env[name]) : fallback);

export async function generate({
  apiKey, model = DEFAULT_MODEL, baseUrl = "https://generativelanguage.googleapis.com", timeoutMs = 30_000, system, user, maxOutputTokens = 200, json = false,
  minIntervalMs = envNumber("GEMINI_MIN_INTERVAL_MS", 5000), retryDelayMs = envNumber("GEMINI_RETRY_DELAY_MS", 30_000), retries = 2,
}) {
  for (let attempt = 0; ; attempt++) {
    await pace(minIntervalMs);
    // The key goes in a header, not the URL, so no error message or log line can carry it.
    const res = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens, temperature: 0.2, ...(json ? { response_mime_type: "application/json" } : {}) },
      }),
    });
    if (res.ok) {
      const body = await res.json();
      return (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    }
    const { detail, retryMs } = await errorInfo(res, apiKey);
    // 429 is usually the per-minute limit: wait and try again. If it persists (the daily quota), stop.
    if (res.status === 429 && attempt < retries) {
      const wait = Math.max(retryMs ?? 0, retryDelayMs);
      console.log(`::notice::Gemini rate limit (HTTP 429); retrying in ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    // 429 after retries; 400/401/403 a bad or disabled key; 404 a model name this API does not serve.
    // More calls would only repeat the failure, so these stop the run's calls.
    if ([400, 401, 403, 404, 429].includes(res.status)) throw new HaltGemini(`HTTP ${res.status}${detail}`);
    throw new Error(`HTTP ${res.status}${detail}`);
  }
}
