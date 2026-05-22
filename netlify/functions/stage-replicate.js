const https = require("https");
const zlib = require("zlib");

// ── HTTPS helper ──────────────────────────────────────────────────────────────
function httpsRequest(options, bodyStr) {
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Fetch output image as base64 ──────────────────────────────────────────────
function fetchImageAsBase64(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { "User-Agent": "SmartStageAI/1.0" }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchImageAsBase64(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Generate grayscale mask PNG in pure Node ──────────────────────────────────
// White = inpaint here (floor/empty space), Black = preserve (ceiling/architecture)
// Uses a gradient: top 25% black, 25-45% gradient, 45%+ white
function generateMaskBase64(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width + 1);
    row[0] = 0; // PNG filter: None
    const p = y / height;
    let val;
    if (p < 0.22) val = 0;
    else if (p < 0.42) val = Math.round(((p - 0.22) / 0.20) * 255);
    else val = 255;
    for (let x = 1; x <= width; x++) row[x] = val;
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  // Build PNG
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = pngChunk("IHDR", Buffer.from([
    0,0,(width>>8)&0xff,width&0xff,
    0,0,(height>>8)&0xff,height&0xff,
    8,0,0,0,0
  ]));
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]).toString("base64");
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
let _ct = null;
function crc32(buf) {
  if (!_ct) { _ct = new Uint32Array(256); for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);_ct[n]=c;} }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c>>>8)^_ct[(c^buf[i])&0xff];
  return c^0xffffffff;
}

// ── Poll prediction ───────────────────────────────────────────────────────────
async function pollPrediction(id, apiKey, maxMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 4000));
    const r = await httpsRequest({
      hostname: "api.replicate.com",
      path: `/v1/predictions/${id}`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const { status, output, error, logs } = r.body;
    console.log("Poll status:", status, logs ? logs.slice(-100) : "");
    if (status === "succeeded") return output;
    if (status === "failed" || status === "canceled") throw new Error("Prediction " + status + ": " + (error || "unknown"));
  }
  throw new Error("Prediction timed out after 90 seconds");
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { imageBase64, mimeType, stagingPrompt } = JSON.parse(event.body);
    if (!imageBase64 || !stagingPrompt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    const apiKey = process.env.REPLICATE_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "REPLICATE_API_KEY not configured" }) };

    const imgMime = mimeType || "image/jpeg";

    // Generate mask (no upload needed — use data URIs directly)
    console.log("Generating mask...");
    const maskBase64 = generateMaskBase64(1024, 1024);

    // Build data URIs — Replicate accepts these directly, no upload needed
    const imageDataUri = `data:${imgMime};base64,${imageBase64}`;
    const maskDataUri = `data:image/png;base64,${maskBase64}`;

    // Negative prompt
    const negativePrompt = "blurry, distorted walls, floating furniture, warped architecture, unrealistic scale, oversized furniture, cluttered, cartoon, illustration, low quality, duplicate objects, impossible shadows, fake windows, extra rooms, hallucinated spaces, people, text";

    // Start prediction using data URIs
    const payload = JSON.stringify({
      version: "95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3",
      input: {
        image: imageDataUri,
        mask: maskDataUri,
        prompt: stagingPrompt,
        negative_prompt: negativePrompt,
        num_inference_steps: 40,
        guidance_scale: 8.5,
        strength: 0.99,
        num_outputs: 1,
        scheduler: "DPMSolverMultistep",
      }
    });

    console.log("Starting prediction...");
    const startResult = await httpsRequest({
      hostname: "api.replicate.com",
      path: "/v1/predictions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      }
    }, payload);

    console.log("Start result status:", startResult.status, JSON.stringify(startResult.body).slice(0, 200));

    if (startResult.status !== 201) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to start: " + JSON.stringify(startResult.body).slice(0, 200) }) };
    }

    const predictionId = startResult.body.id;
    console.log("Prediction ID:", predictionId);

    // Poll for result
    const output = await pollPrediction(predictionId, apiKey);
    const outputUrl = Array.isArray(output) ? output[0] : output;
    if (!outputUrl) throw new Error("No output URL from Replicate");

    console.log("Fetching result image from:", outputUrl);
    const stagedBase64 = await fetchImageAsBase64(outputUrl);

    return { statusCode: 200, headers, body: JSON.stringify({ stagedBase64, engine: "replicate-sdxl" }) };

  } catch (err) {
    console.error("stage-replicate error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
