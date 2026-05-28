// stage-openai-background.js — Netlify Background Function
// Runs up to 15 minutes — no timeout wall
// Triggered by stage-openai.js, stores result in Netlify Blobs
// Client polls check-decor8.js for result

const https = require("https");

// ── MULTIPART BUILDER — mirrors stage-image-start.js proven pattern ───────────
function buildMultipart(imageBuffer, imageMime, prompt) {
  const boundary = "----OAIBoundary" + Math.random().toString(36).slice(2);
  const parts = [];

  // All text fields first as plain strings
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1536x1024`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nmedium`);

  const textBuf  = Buffer.from(parts.join("\r\n") + "\r\n", "utf8");
  const fileHdr  = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="room.jpg"\r\nContent-Type: ${imageMime}\r\n\r\n`,
    "utf8"
  );
  const closing  = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  const body = Buffer.concat([textBuf, fileHdr, imageBuffer, closing]);
  return { body, boundary };
}

// ── OPENAI CALL ───────────────────────────────────────────────────────────────
async function callOpenAI(imageBase64, mimeType, prompt, apiKey) {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const { body, boundary } = buildMultipart(imageBuffer, mimeType || "image/jpeg", prompt);

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

// ── STORE RESULT IN NETLIFY BLOBS ─────────────────────────────────────────────
async function storeResult(jobId, data, token, siteId) {
  const body = Buffer.from(JSON.stringify(data));
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.netlify.com",
      path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent("job-" + jobId)}`,
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": body.length,
      }
    }, (res) => { res.resume(); res.on("end", resolve); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const token    = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId   = process.env.NETLIFY_SITE_ID;
  const openAIKey = process.env.OPENAI_API_KEY;

  console.log(`stage-openai-background env: siteId=${siteId ? siteId.slice(0,8)+'...' : 'MISSING'} token=${token ? 'present' : 'MISSING'} openai=${openAIKey ? 'present' : 'MISSING'}`);

  let jobId;
  try {
    const { jobId: jId, imageBase64, mimeType, customPrompt, siteId: payloadSiteId } = JSON.parse(event.body);
    jobId = jId;

    // Use siteId from payload if provided — ensures blob is written to the same
    // site that check-decor8 reads from (avoids cross-site blob mismatch)
    const writeSiteId = payloadSiteId || siteId;

    console.log(`Background job ${jobId} starting... writeSiteId=${writeSiteId?.slice(0,8)}`);

    // Call OpenAI — no timeout wall in background functions
    const result = await callOpenAI(imageBase64, mimeType, customPrompt, openAIKey);
    console.log(`Job ${jobId}: OpenAI complete`);

    // Extract base64 — gpt-image-1 returns b64_json
    const stagedBase64 = result?.data?.[0]?.b64_json;
    if (!stagedBase64) throw new Error("No image data in OpenAI response: " + JSON.stringify(result).slice(0, 200));

    console.log(`Job ${jobId}: Result size ${Math.round(stagedBase64.length/1024)}KB`);

    // Store success in Blobs — check-decor8.js will return this to client
    await storeResult(jobId, { status: "done", stagedBase64, width: 1536, height: 1024 }, token, writeSiteId);
    console.log(`Job ${jobId}: Stored in Blobs siteId=${writeSiteId?.slice(0,8)}`);

  } catch (err) {
    console.error(`Job ${jobId} error:`, err.message);
    if (jobId && token && siteId) {
      try { await storeResult(jobId, { status: "error", error: err.message }, token, siteId); } catch(e) {}
    }
  }
};
