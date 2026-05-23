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
    const { stagedBase64, mimeType } = JSON.parse(event.body);
    if (!stagedBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: "stagedBase64 required" }) };

    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };

    const systemPrompt = `You are a professional interior design analyst. Your job is to read a virtually staged room photo and extract precise furniture and material specifications that will be used to ensure all other rooms in the same home are staged with a consistent design language.

You must return ONLY a valid JSON object — no explanation, no markdown, no preamble. The JSON must be parseable by JSON.parse() with no cleanup required.`;

    const userPrompt = `Analyze this virtually staged open plan living space and extract the Design DNA — the specific furniture pieces, materials, finishes, and palette that define the staging style for this home.

Return a single JSON object with exactly these fields:

{
  "overallStyle": "One phrase describing the overall design style, e.g. Organic Modern, Transitional Coastal, RH Luxury",
  "sofa": "Describe the sofa: fabric type, color, profile (low/high back), leg style, approximate size",
  "diningTable": "Describe the dining table: material, finish, shape, approximate size",
  "diningChairs": "Describe the dining chairs: material, color, style, upholstery if any",
  "barStools": "Describe the bar stools if visible: seat material, frame material, style. If not visible write null",
  "areaRug": "Describe the area rug: texture, color, pattern, approximate size",
  "coffeeTable": "Describe the coffee table: material, shape, finish",
  "accentChairs": "Describe accent chairs if visible: fabric, color, style. If not visible write null",
  "woodTones": "Dominant wood tone used across furniture: e.g. light blonde oak, warm walnut, cerused white oak",
  "metalFinishes": "Dominant metal finish: e.g. brushed nickel, matte black, antique brass, brushed gold",
  "colorPalette": ["primary color", "secondary color", "accent color"],
  "artStyle": "Describe the wall art style and colors if visible",
  "stagingDensity": "light, moderate, or full — how densely furnished the space feels",
  "continuityPrompt": "Write a 2-3 sentence design continuity instruction that will be prepended to prompts for other rooms in this home. Describe the established aesthetic so other rooms feel like they belong to the same home. Reference specific materials, palette, and style without repeating furniture that only belongs in this room."
}

Be specific and precise. The values in this object will be injected directly into staging prompts for bedrooms, bathrooms, and other rooms — so the descriptions must be detailed enough to guide furniture selection in those rooms.`;

    const payload = JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType || "image/jpeg",
              data: stagedBase64
            }
          },
          { type: "text", text: userPrompt }
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
      console.error("Claude DNA extraction error:", JSON.stringify(result.body).slice(0, 300));
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Claude DNA extraction failed" }) };
    }

    const raw = result.body?.content?.[0]?.text?.trim();
    if (!raw) return { statusCode: 500, headers, body: JSON.stringify({ error: "No response from Claude" }) };

    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let dna;
    try {
      dna = JSON.parse(clean);
    } catch (e) {
      console.error("DNA JSON parse failed:", clean.slice(0, 300));
      return { statusCode: 500, headers, body: JSON.stringify({ error: "DNA parse failed — invalid JSON returned" }) };
    }

    // Validate required fields are present
    const required = ["overallStyle", "woodTones", "metalFinishes", "colorPalette", "continuityPrompt"];
    const missing = required.filter(k => !dna[k]);
    if (missing.length) {
      console.warn("DNA missing fields:", missing);
      // Don't fail — return what we have, caller handles partial DNA
    }

    // Ensure colorPalette is always an array
    if (typeof dna.colorPalette === "string") {
      dna.colorPalette = dna.colorPalette.split(",").map(s => s.trim());
    }

    console.log("DNA extracted:", dna.overallStyle, "| wood:", dna.woodTones, "| metals:", dna.metalFinishes);
    return { statusCode: 200, headers, body: JSON.stringify({ dna }) };

  } catch (err) {
    console.error("extract-staging-dna error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
