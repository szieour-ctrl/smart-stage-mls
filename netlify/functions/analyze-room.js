const https = require("https");

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: { raw } }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { imageBase64, mimeType, roomName } = JSON.parse(event.body);
    if (!imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing imageBase64" }) };

    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };

    const prompt = `You are analyzing a real estate listing photo of a ${roomName || "room"} to generate precise furniture placement instructions for AI virtual staging.

Analyze this photo carefully and return ONLY valid JSON — no markdown, no explanation.

Examine:
1. Camera position and angle (where is the photographer standing, what direction are they facing)
2. Room focal point (fireplace, windows, feature wall, island)
3. Islands/peninsulas — which side faces the camera vs away from camera
4. Empty floor areas — describe exactly where open floor space is
5. Existing permanent fixtures (appliances, cabinetry, fireplace, windows) — note their positions
6. Connected/adjacent visible spaces
7. Natural light direction
8. What furniture would logically go WHERE based on the actual geometry

Return this exact shape:
{
  "cameraFacing": "description of camera position and direction",
  "focalPoint": "primary visual anchor of the room",
  "islandSides": "if kitchen — which side of island faces camera (near) vs away (far/back)",
  "openFloorAreas": "description of where empty floor space exists",
  "furniturePlacement": [
    "Bar stools/seating: specific side and distance from camera",
    "Primary seating: specific wall or area",
    "Dining: specific location if applicable",
    "Other key pieces: specific placement"
  ],
  "avoidAreas": ["list areas where furniture must NOT go — e.g. in front of appliances, blocking pathways"],
  "lightDirection": "where natural light is coming from",
  "spatialNotes": "any other important spatial context for staging"
}`;

    const payload = JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 }
          },
          { type: "text", text: prompt }
        ]
      }]
    });

    const result = await httpsRequest({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, payload);

    if (result.status !== 200) {
      console.error("Claude error:", JSON.stringify(result.body).slice(0, 200));
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Claude analysis failed" }) };
    }

    const text = result.body?.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch(e) {
      // If JSON parse fails, return raw text so frontend can still use it
      analysis = { spatialNotes: clean, furniturePlacement: [], avoidAreas: [] };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ analysis }) };

  } catch (err) {
    console.error("analyze-room error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
