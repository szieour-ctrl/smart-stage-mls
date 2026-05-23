// Job launcher — stores payload, fires background function, returns jobId immediately
// Client polls check-decor8.js for result

const https = require("https");

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: { raw } }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? Buffer.from(body) : body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };

  try {
    const body = JSON.parse(event.body);
    const { imageBase64, mimeType, roomType, designStyle, colorScheme, customPrompt } = body;
    if (!imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing imageBase64" }) };

    const decor8Key = process.env.DECOR8_API_KEY;
    if (!decor8Key) return { statusCode: 500, headers, body: JSON.stringify({ error: "DECOR8_API_KEY not configured" }) };

    const imgbbKey = process.env.IMGBB_API_KEY;
    if (!imgbbKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "IMGBB_API_KEY not configured" }) };

    // Generate unique job ID
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Fire background function asynchronously
    const siteUrl = process.env.URL || "https://smart-stage-ai.netlify.app";
    const bgPayload = JSON.stringify({ jobId, imageBase64, mimeType, roomType, designStyle, colorScheme, customPrompt });

    // Trigger background function — don't await, fire and forget
    const bgUrl = new URL(`${siteUrl}/.netlify/functions/stage-decor8-background`);
    httpsRequest({
      hostname: bgUrl.hostname,
      path: bgUrl.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bgPayload) }
    }, bgPayload).catch(err => console.error("Background trigger error:", err.message));

    console.log(`Job ${jobId} launched — background processing started`);

    // Return jobId immediately
    return { statusCode: 202, headers, body: JSON.stringify({ jobId, status: "processing" }) };

  } catch (err) {
    console.error("stage-decor8 error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
