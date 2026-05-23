const https = require("https");
const { Buffer } = require("buffer");

// ── HTTPS helper ──────────────────────────────────────────────────────────────
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
    if (body) req.write(typeof body === "string" ? body : body);
    req.end();
  });
}

// ── Upload image to ImgBB via multipart form ─────────────────────────────────
async function getImageUrl(imageBase64, mimeType) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("IMGBB_API_KEY not configured");

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const boundary = "----ImgBBBoundary" + Math.random().toString(36).slice(2);
  const ext = (mimeType || "image/jpeg").includes("png") ? "png" : "jpg";

  // Build multipart — send raw binary (faster than base64 re-encoding)
  const partHeader = Buffer.from(
    `--${boundary}
Content-Disposition: form-data; name="image"; filename="room.${ext}"
Content-Type: ${mimeType || "image/jpeg"}

`,
    "utf8"
  );
  const partFooter = Buffer.from(`
--${boundary}--
`, "utf8");
  const body = Buffer.concat([partHeader, imageBuffer, partFooter]);

  console.log(`Uploading to ImgBB: ${Math.round(body.length/1024)}KB`);

  const result = await httpsRequest({
    hostname: "api.imgbb.com",
    path: `/1/upload?key=${apiKey}&expiration=3600`,
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    }
  }, body);

  console.log("ImgBB status:", result.status);
  if (result.status !== 200) {
    throw new Error(`ImgBB upload failed: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  }

  const url = result.body?.data?.url;
  if (!url) throw new Error("No URL from ImgBB: " + JSON.stringify(result.body).slice(0, 200));
  console.log("ImgBB URL:", url);
  return { url, key: result.body?.data?.id };
}

// ── Call Decor8 staging API ───────────────────────────────────────────────────
async function callDecor8(imageUrl, roomType, designStyle, colorScheme, customPrompt, apiKey) {
  const payload = JSON.stringify({
    input_image_url: imageUrl,
    room_type: roomType || "openplan",
    design_style: designStyle || "transitional",
    num_images: 1,
    scale_factor: 2, // max 1536px, no extra cost
    color_scheme: colorScheme || "COLOR_SCHEME_9",
    ...(customPrompt ? { prompt: customPrompt } : {}),
  });

  console.log(`Decor8 call: room=${roomType} style=${designStyle} promptLen=${customPrompt?.length || 0}`);

  const result = await httpsRequest({
    hostname: "api.decor8.ai",
    path: "/generate_designs_for_room",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    }
  }, payload);

  console.log("Decor8 response status:", result.status);
  if (result.status !== 200) {
    console.error("Decor8 error:", JSON.stringify(result.body).slice(0, 300));
    throw new Error(result.body?.error || result.body?.message || `Decor8 API error ${result.status}`);
  }

  // Decor8 returns info.images array
  const images = result.body?.info?.images;
  if (!images?.length) {
    console.error("No images in Decor8 response:", JSON.stringify(result.body).slice(0, 300));
    throw new Error("No images returned from Decor8");
  }

  return images[0]; // { url, width, height }
}

// ── Fetch result image as base64 ──────────────────────────────────────────────
function fetchAsBase64(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) { reject(new Error("Too many redirects")); return; }
    const u = new URL(url);
    https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: { "User-Agent": "SmartStageAI/1.0" }
    }, (res) => {
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

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const {
      imageBase64, mimeType,
      roomType, designStyle, colorScheme,
      customPrompt,
    } = JSON.parse(event.body);

    if (!imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing imageBase64" }) };

    const decor8Key = process.env.DECOR8_API_KEY;
    if (!decor8Key) return { statusCode: 500, headers, body: JSON.stringify({ error: "DECOR8_API_KEY not configured" }) };

    // Step 1: Upload image via proxy to get public URL
    console.log("Uploading image for public URL...");
    const { url: imageUrl, key: blobKey } = await getImageUrl(imageBase64, mimeType);
    console.log("Image URL:", imageUrl);

    // Step 2: Call Decor8
    console.log("Calling Decor8 API...");
    const imageResult = await callDecor8(imageUrl, roomType, designStyle, colorScheme, customPrompt, decor8Key);
    console.log("Decor8 result:", imageResult.url?.slice(0, 80));

    // Step 3: Fetch result as base64
    const stagedBase64 = await fetchAsBase64(imageResult.url);
    console.log("Result fetched, size:", Math.round(stagedBase64.length / 1024), "KB");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stagedBase64,
        engine: "decor8",
        width: imageResult.width,
        height: imageResult.height,
        blobKey, // return so frontend can clean up if needed
      })
    };

  } catch (err) {
    console.error("stage-decor8 error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
