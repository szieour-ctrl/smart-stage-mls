// stage-openai.js
// Drop-in replacement for stage-decor8.js
// Uses OpenAI gpt-image-1 via /v1/images/edits (multipart/form-data)
// Input:  imageBase64, mimeType, customPrompt
// Output: stagedBase64, width, height — identical shape to stage-decor8.js
// No ImgBB needed — image sent directly as multipart binary

const https = require("https");

// ── MULTIPART FORM-DATA BUILDER ───────────────────────────────────────────────
function buildMultipart(imageBuffer, mimeType, prompt) {
  const boundary = "----OAIBoundary" + Math.random().toString(36).slice(2);
  const ext = (mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
  const crlf = "\r\n";

  const parts = [];

  // image field
  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="image"; filename="room.${ext}"${crlf}` +
    `Content-Type: ${mimeType || "image/jpeg"}${crlf}${crlf}`,
    "utf8"
  ));
  parts.push(imageBuffer);
  parts.push(Buffer.from(crlf, "utf8"));

  // model field
  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="model"${crlf}${crlf}` +
    `gpt-image-1${crlf}`,
    "utf8"
  ));

  // prompt field
  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="prompt"${crlf}${crlf}` +
    `${prompt}${crlf}`,
    "utf8"
  ));

  // size field — 1536x1024 landscape for real estate photography
  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="size"${crlf}${crlf}` +
    `1536x1024${crlf}`,
    "utf8"
  ));

  // n field
  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="n"${crlf}${crlf}` +
    `1${crlf}`,
    "utf8"
  ));

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));

  const body = Buffer.concat(parts);
  return { body, boundary };
}

// ── OPENAI IMAGE EDIT CALL ────────────────────────────────────────────────────
async function callOpenAI(imageBase64, mimeType, prompt, apiKey) {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const { body, boundary } = buildMultipart(imageBuffer, mimeType, prompt);

  console.log(`OpenAI gpt-image-1: prompt ${prompt.length} chars, image ${Math.round(imageBuffer.length/1024)}KB`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/images/edits",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      }
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI error ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`));
          } else {
            resolve(parsed);
          }
        } catch(e) {
          reject(new Error(`OpenAI parse error: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── FETCH URL AS BASE64 (fallback if OpenAI returns URL instead of b64_json) ──
async function fetchAsBase64(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) { reject(new Error("Too many redirects")); return; }
    const u = new URL(url);
    https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "GET" }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchAsBase64(res.headers.location, hops + 1).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    }).on("error", reject).end();
  });
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { imageBase64, mimeType, customPrompt } = JSON.parse(event.body);
    if (!imageBase64)    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing imageBase64" }) };
    if (!customPrompt)   return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing customPrompt — gpt-image-1 requires a prompt" }) };

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "OPENAI_API_KEY not configured" }) };

    // Call OpenAI
    const result = await callOpenAI(imageBase64, mimeType, customPrompt, openAIKey);

    // gpt-image-1 returns: { data: [{ b64_json: "..." }] }
    // Log full response shape for debugging on first deploy
    console.log("OpenAI response keys:", Object.keys(result || {}));
    console.log("OpenAI data[0] keys:", Object.keys(result?.data?.[0] || {}));

    let stagedBase64 = result?.data?.[0]?.b64_json;

    // Fallback: if URL returned instead of b64_json, fetch and convert
    if (!stagedBase64 && result?.data?.[0]?.url) {
      console.log("OpenAI returned URL — fetching as base64...");
      stagedBase64 = await fetchAsBase64(result.data[0].url);
    }

    if (!stagedBase64) throw new Error("No image returned from OpenAI: " + JSON.stringify(result).slice(0, 300));

    console.log("OpenAI staging complete. Result size:", Math.round(stagedBase64.length / 1024), "KB");

    // Return identical shape to stage-decor8.js so index.html needs no changes
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stagedBase64,
        width: 1536,
        height: 1024,
      }),
    };

  } catch (err) {
    console.error("stage-openai error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message, retryable: true }) };
  }
};
