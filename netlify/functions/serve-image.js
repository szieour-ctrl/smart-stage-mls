const https = require("https");

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buffer: buf });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? Buffer.from(body) : body);
    req.end();
  });
}

// Follow redirects and return final buffer
async function fetchFinal(url, hops = 0) {
  if (hops > 5) throw new Error("Too many redirects");
  const u = new URL(url);
  const r = await httpsReq({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if ((r.status === 301 || r.status === 302 || r.status === 307) && r.headers.location) {
    console.log("Redirect to:", r.headers.location);
    return fetchFinal(r.headers.location, hops + 1);
  }
  return { status: r.status, buffer: r.buffer };
}

exports.handler = async (event) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const json = { ...cors, "Content-Type": "application/json" };
  const token = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  // ── POST: store image as base64 text, return public GET URL ──────────────
  if (event.httpMethod === "POST") {
    try {
      const { imageBase64, mimeType } = JSON.parse(event.body);
      const key = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Store as plain base64 TEXT — avoids all binary encoding issues
      const textBody = Buffer.from(JSON.stringify({ b64: imageBase64, mime: mimeType || "image/jpeg" }));

      const r = await httpsReq({
        hostname: "api.netlify.com",
        path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent(key)}`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": textBody.length,
        }
      }, textBody);

      console.log("Blob PUT status:", r.status, r.buffer.toString("utf8").slice(0, 100));

      const siteUrl = process.env.URL || "https://smart-stage-ai.netlify.app";
      const url = `${siteUrl}/.netlify/functions/serve-image?key=${key}`;
      console.log("Stored image, public URL:", url);
      return { statusCode: 200, headers: json, body: JSON.stringify({ url, key }) };
    } catch(err) {
      console.error("POST error:", err.message);
      return { statusCode: 500, headers: json, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── GET: fetch base64 text from blobs, decode, serve as image ────────────
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key;
    if (!key) return { statusCode: 400, headers: json, body: JSON.stringify({ error: "Missing key" }) };

    try {
      console.log("Serving image for key:", key);
      // Fetch the JSON text we stored
      const r = await httpsReq({
        hostname: "api.netlify.com",
        path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent(key)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      });

      console.log("Blob GET status:", r.status);

      let imageBase64, mimeType;

      if (r.status === 200) {
        const parsed = JSON.parse(r.buffer.toString("utf8"));
        imageBase64 = parsed.b64;
        mimeType = parsed.mime || "image/jpeg";
      } else if (r.status === 301 || r.status === 302 || r.status === 307) {
        // Follow redirect
        const loc = r.headers.location;
        console.log("Following redirect to:", loc);
        const final = await fetchFinal(loc);
        console.log("Final status:", final.status, "size:", final.buffer.length);
        const parsed = JSON.parse(final.buffer.toString("utf8"));
        imageBase64 = parsed.b64;
        mimeType = parsed.mime || "image/jpeg";
      } else {
        return { statusCode: 404, headers: json, body: JSON.stringify({ error: "Not found", status: r.status }) };
      }

      if (!imageBase64) return { statusCode: 500, headers: json, body: JSON.stringify({ error: "No image data" }) };

      const imgBuf = Buffer.from(imageBase64, "base64");
      console.log("Serving:", imgBuf.length, "bytes,", mimeType, "valid JPEG:", imgBuf[0]===0xFF&&imgBuf[1]===0xD8);

      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": mimeType, "Cache-Control": "public, max-age=3600" },
        body: imageBase64,
        isBase64Encoded: true,
      };
    } catch(err) {
      console.error("GET error:", err.message);
      return { statusCode: 500, headers: json, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
