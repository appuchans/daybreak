// One place for the Gemini REST call, shared by summaries and classification.
// Both are optional and fail open: the build never depends on this module succeeding.

export const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // the API itself named this when 2.5-flash-lite returned 404 "no longer available to new users" (2026-10-03)

// Stop the whole run: the key is wrong or the quota is spent, so more calls would only fail.
export class HaltGemini extends Error {}

// Google's error body is {"error": {"code", "message", "status"}}. Keep a short, key-free excerpt so a
// failure can be diagnosed from the build log.
async function errorDetail(res, apiKey) {
  try {
    const e = (await res.json())?.error;
    const text = `${e?.status ?? ""} ${e?.message ?? ""}`.split(apiKey).join("***").replace(/\s+/g, " ").trim().slice(0, 200);
    return text ? ` ${text}` : "";
  } catch {
    return "";
  }
}

export async function generate({ apiKey, model = DEFAULT_MODEL, baseUrl = "https://generativelanguage.googleapis.com", timeoutMs = 30_000, system, user, maxOutputTokens = 200, json = false }) {
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
  if (!res.ok) {
    const detail = await errorDetail(res, apiKey);
    // 429 is the quota; 400/401/403 a bad or disabled key; 404 a model name this API does not serve.
    // More calls would only repeat the failure, so these stop the run's calls.
    if ([400, 401, 403, 404, 429].includes(res.status)) throw new HaltGemini(`HTTP ${res.status}${detail}`);
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  const body = await res.json();
  return (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}
