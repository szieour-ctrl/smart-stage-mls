// Public image proxy for Decor8 API
// POST: store image, return public serve URL
// GET: fetch and serve image publicly (Decor8 calls this)

const https = require("https");

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(buf.toString("utf8")); } catch(e) {}
        resolve({ status: res.statusCode, headers: res.headers, buffer: buf, json: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? Buffer.from(body) : body);
    req.end();
  });
}

async function fetchUrlAsBuffer(url, hops = 0) {
  if (hops > 5) throw new Error("Too many redirects");
  const u = new URL(url);
  const res = await httpsReq({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: "GET",
    headers: { "User-Agent": "SmartStageAI/1.0" }
  });
  if (res.status === 301 || res.status === 302) {
    return fetchUrlAsBuffer(res.headers.location, hops + 1);
  }
  return res.buffer;
}

exports.handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  const json = { ...cors, "Content-Type": "application/json" };

  const token = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) return { statusCode: 500, headers: json, body: JSON.stringify({ error: "Storage not configured" }) };

  // ── GET: serve image to Decor8 ─────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key;
    if (!key) return { statusCode: 400, headers: json, body: JSON.stringify({ error: "Missing key" }) };

    try {
      // Fetch from Netlify Blobs REST API — follows redirect to CDN
      const result = await httpsReq({
        hostname: "api.netlify.com",
        path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent(key)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" }
      });

      let imgBuffer;
      if (result.status === 200) {
        // Direct response
        imgBuffer = result.buffer;
      } else if (result.status === 301 || result.status === 302) {
        // Follow redirect to actual CDN URL
        imgBuffer = await fetchUrlAsBuffer(result.headers.location);
      } else {
        // Try fetching the blob differently — as base64 text we stored
        const asText = result.buffer.toString("utf8").trim();
        if (asText.match(/^[A-Za-z0-9+/]+=*$/)) {
          imgBuffer = Buffer.from(asText, "base64");
        } else {
          return { statusCode: 404, headers: json, body: JSON.stringify({ error: "Image not found", status: result.status }) };
        }
      }

      // Verify it looks like a JPEG (starts with FF D8 FF)
      const isJpeg = imgBuffer[0] === 0xFF && imgBuffer[1] === 0xD8;
      const isPng = imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50;
      const mimeType = isPng ? "image/png" : "image/jpeg";

      console.log(`Serving image: ${imgBuffer.length} bytes, JPEG: ${isJpeg}, PNG: ${isPng}`);

      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": mimeType, "Cache-Control": "public, max-age=3600" },
        body: imgBuffer.toString("base64"),
        isBase64Encoded: true,
      };
    } catch(err) {
      console.error("serve-image GET error:", err.message);
      return { statusCode: 500, headers: json, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: store image, return public URL ───────────────────────────────────
  if (event.httpMethod === "POST") {
    try {
      const { imageBase64, mimeType } = JSON.parse(event.body);
      const key = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const imgBuffer = Buffer.from(imageBase64, "base64");

      console.log(`Storing image: ${imgBuffer.length} bytes, mime: ${mimeType}`);

      // Store as raw binary in Netlify Blobs
      const storeResult = await httpsReq({
        hostname: "api.netlify.com",
        path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent(key)}`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": mimeType || "image/jpeg",
          "Content-Length": imgBuffer.length,
        }
      }, imgBuffer);

      console.log(`Blob store status: ${storeResult.status}`);

      const siteUrl = process.env.URL || "https://smart-stage-ai.netlify.app";
      const publicUrl = `${siteUrl}/.netlify/functions/serve-image?key=${key}`;

      return { statusCode: 200, headers: json, body: JSON.stringify({ url: publicUrl, key }) };
    } catch(err) {
      console.error("serve-image POST error:", err.message);
      return { statusCode: 500, headers: json, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
