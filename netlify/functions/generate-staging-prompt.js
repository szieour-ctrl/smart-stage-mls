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

// ── OPEN PLAN PROMPT BUILDER ──────────────────────────────────────────────────
// Claude returns metadata. JS assembles the deterministic prompt.
// Decor8 receives: short, structured, anchor-based guidance only.
// No prose. No exact dimensions. No placement coordinates.
function buildOpenPlanPrompt({ preserveList, designStyle, colorPalette, designDNA, spatialDNA, openPlanStrategy }) {

  // Strategy A — pure native Decor8, no custom prompt
  if (openPlanStrategy === 'native') return null;

  const living  = spatialDNA?.zoneRelationships?.find(z => z.zone === 'living')  || { anchor: 'fireplace',   boundary: 'rectangular rug' };
  const dining  = spatialDNA?.zoneRelationships?.find(z => z.zone === 'dining')  || { anchor: 'chandelier',  boundary: 'oval rug' };
  const kitchen = spatialDNA?.zoneRelationships?.find(z => z.zone === 'kitchen') || { anchor: 'island',      boundary: null };

  const primaryZone   = spatialDNA?.primaryZone   || 'living';
  const secondaryZone = spatialDNA?.secondaryZone  || 'dining';

  // Style/palette from DNA if available, otherwise from session intake
  const style   = designDNA?.overallStyle || designStyle || 'Organic Modern';
  const palette = designDNA?.colorPalette
    ? (Array.isArray(designDNA.colorPalette) ? designDNA.colorPalette.join(', ') : designDNA.colorPalette)
    : colorPalette || 'warm neutrals';
  const wood    = designDNA?.woodTones    || 'natural oak';
  const metals  = designDNA?.metalFinishes || 'brushed nickel';

  // Strategy C — full placement control (longer prompt)
  if (openPlanStrategy === 'full') {
    return `PRESERVE EXACTLY: ${preserveList}

Open-concept great room with connected kitchen, dining, and living areas. Preserve all original architecture, room dimensions, wall placement, windows, cabinetry, appliances, ceiling height, flooring layout, and camera perspective.

Create cohesive ${style} staging throughout the entire shared space using ${wood}, ${metals}, and a ${palette} palette.

Living room zone: Define the primary seating area around the ${living.anchor} using a large ${living.boundary} and a proportional high-density seating group facing the ${living.anchor}. Maintain realistic circulation around all furniture.

Dining zone: Define the dining area around the ${dining.anchor} using a large ${dining.boundary} centered directly beneath the ${dining.anchor}. Place a dining table with chairs centered on the rug with proper spacing and natural traffic flow.

Kitchen zone: Add proportional counter stools on the far side of the island only — NOT the camera-facing side. Minimal countertop styling — one small plant or bowl, nothing more.

Maintain realistic circulation paths and visual openness between all connected zones. MLS-photorealistic staging only.

Do not alter architecture, room dimensions, cabinetry, flooring layout, windows, walls, ceiling structure, appliances, fireplace dimensions, or camera perspective. Avoid excessive furniture, clutter, distorted geometry, duplicate objects, warped rugs, floating furniture, or fantasy lighting.`;
  }

  // Strategy B — guided zoning (default, shorter, lighter)
  return `PRESERVE EXACTLY: ${preserveList}

Open-concept great room with connected kitchen, dining, and living spaces. Create cohesive ${style} staging throughout the entire shared space using ${wood}, ${metals}, and a ${palette} palette.

Define the primary ${primaryZone} area around the ${living.anchor} using a large ${living.boundary} and proportional seating group.

Define the ${secondaryZone} zone around the ${dining.anchor} using a large ${dining.boundary} with a moderate-density dining arrangement.

Kitchen styling should remain light and minimal with proportional counter stools on the far side of the island only.

Maintain realistic circulation paths and visual openness between all connected zones. MLS-photorealistic staging only.

Do not alter architecture, room dimensions, cabinetry, flooring layout, windows, walls, ceiling structure, appliances, fireplace dimensions, or camera perspective. Avoid excessive furniture, clutter, distorted geometry, duplicate objects, warped rugs, floating furniture, or fantasy lighting.`;
}

// ── CLAUDE VISION — METADATA EXTRACTION FOR OPEN PLAN ────────────────────────
// Claude's ONLY job for open plan: classify, detect anchors, build preserve list.
// Claude does NOT write the final prompt — JS does.
async function extractOpenPlanMetadata({ imageBase64, mimeType, roomName, claudeKey }) {
  const prompt = `You are analyzing a real estate listing photo for MLS virtual staging.
Return ONLY valid JSON — no markdown, no explanation.

Analyze this photo and return:

{
  "preserveList": "comprehensive comma-separated list of every permanent element visible — exact color and material: cabinetry color/style, countertop material, flooring, fireplace surround color/material, ALL ceiling fixtures by location (chandelier, pendants, ceiling fan), windows, appliances, island geometry and base color, tile, hardware, doors, trim. End with 'DO NOT remove or relocate the kitchen island.' if island is visible.",
  "zones": [
    {
      "zone": "living | dining | kitchen",
      "anchor": "fireplace | chandelier | island | ceiling fan | window wall",
      "boundary": "rectangular rug | oval rug | none",
      "density": "light | medium | high",
      "visible": true
    }
  ],
  "primaryZone": "living | dining | kitchen",
  "secondaryZone": "living | dining | kitchen",
  "trafficFlow": "open_central | perimeter | diagonal",
  "islandCameraSide": "near (camera-facing, NO stools) | far (away from camera, stool side) | null"
}

Only include zones that are actually visible in the photo. Order zones by visual prominence.`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 } },
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

  if (result.status !== 200) throw new Error("Claude metadata extraction failed");

  const text = result.body?.content?.[0]?.text?.trim() || "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch(e) { return { preserveList: "", zones: [], primaryZone: "living", secondaryZone: "dining" }; }
}

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
      roomName, roomType, openPlanZones,
      designStyle, colorPalette,
      buyerProfile, desiredFeeling,
      stagingIntensity, mlsMode,
      iterationNote, priorStagingDescription,
      shotFocus, adjacentRooms,
      anchorDNA, stagingDNA, dnaTier,
      openPlanStrategy,
    } = JSON.parse(event.body);

    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };

    const isIteration = !!(iterationNote && priorStagingDescription);
    const isOpenPlan  = !!openPlanZones;

    // ── OPEN PLAN — METADATA → DETERMINISTIC PROMPT ──────────────────────────
    if (isOpenPlan && !isIteration) {

      // Strategy A: Native Decor8 — no prompt at all
      if (openPlanStrategy === 'native') {
        console.log("Open plan: NATIVE strategy — no custom prompt");
        return { statusCode: 200, headers, body: JSON.stringify({ prompt: null }) };
      }

      // Strategies B and C: Claude extracts metadata, JS builds the prompt
      console.log("Open plan: extracting metadata for strategy", openPlanStrategy || 'guided');
      const metadata = await extractOpenPlanMetadata({ imageBase64, mimeType, roomName, claudeKey });

      const spatialDNA = metadata.zones ? {
        zoneRelationships: metadata.zones.filter(z => z.visible !== false),
        primaryZone:   metadata.primaryZone   || 'living',
        secondaryZone: metadata.secondaryZone || 'dining',
        trafficFlow:   metadata.trafficFlow   || 'open_central',
      } : stagingDNA?.spatialDNA || null;

      const prompt = buildOpenPlanPrompt({
        preserveList: metadata.preserveList || '',
        designStyle,
        colorPalette,
        designDNA: stagingDNA,
        spatialDNA,
        openPlanStrategy: openPlanStrategy || 'guided',
      });

      console.log("Open plan prompt built:", prompt ? `${prompt.length} chars` : "null (native)");
      return { statusCode: 200, headers, body: JSON.stringify({ prompt, metadata }) };
    }

    // ── SINGLE ROOM & ITERATION — CLAUDE VISION GENERATES PROSE ──────────────
    const systemPrompt = `You are an expert real estate staging consultant generating virtual staging prompts for MLS listing photography. This tool is used exclusively for MetroList MLS listings — not a design or remodel tool.

MLS PRESERVE LAW — ABSOLUTE — OVERRIDES EVERYTHING ELSE:
Every prompt you generate MUST begin with a PRESERVE EXACTLY block listing every permanent element visible in the photo. These elements MUST NOT change under any circumstances:
- Cabinetry: color, style, hardware, layout — EXACTLY as photographed
- Countertops: material, color, edge profile — EXACTLY as photographed
- Flooring: material, color, pattern — EXACTLY as photographed
- Walls and paint color — EXACTLY as photographed
- Fixtures: faucets, plumbing, lighting already installed — EXACTLY as photographed
- Mirrors and framed elements already installed — EXACTLY as photographed
- Appliances — EXACTLY as photographed
- Fireplace surround and mantel — EXACTLY as photographed
- Windows, doors, casings, trim — EXACTLY as photographed
- Tile: backsplash, shower, floor — EXACTLY as photographed
- Island geometry and base color — EXACTLY as photographed
- House exterior color and materials — EXACTLY as photographed

The AI staging engine may ONLY add furniture, rugs, art, and soft accessories into empty space. It may NOT remodel, replace, recolor, or alter any existing permanent element.

STAGING SCOPE — ADDITIONS INTO EMPTY SPACE ONLY:
Furniture, area rugs, wall art, minimal accessories, soft goods (pillows, throws, towels, bath mats).

PROPS STANDARDS:
- Countertops: max one tray or bowl, one vase, one plant per surface section
- Wall art: one piece per wall, sized 50-75% of furniture width below it
- Area rugs: one per seating area, front legs of all seating on rug
- Plants: maximum one per room. Less is more — every item must earn its place`;

    let userPrompt;

    if (isIteration) {
      userPrompt = `You are revising a virtual staging result for an MLS listing photo.

MLS PRESERVE LAW — MANDATORY: Begin your prompt with PRESERVE EXACTLY, listing every permanent element visible in the original photo. These MUST NOT change. Only furniture, rugs, art, and soft accessories may be adjusted.

CURRENT STAGING: ${priorStagingDescription}
REVISION REQUESTED: ${iterationNote}
ROOM: ${roomName} | STYLE: ${designStyle} | PALETTE: ${colorPalette} | BUYER: ${buyerProfile}
${anchorDNA ? `DESIGN CONTINUITY (match this): ${anchorDNA}` : ''}

Generate a revised staging prompt that:
1. Opens with PRESERVE EXACTLY — every permanent architectural element
2. Keeps EVERYTHING from the current staging EXCEPT what the revision requests
3. Makes ONLY the specific changes requested — nothing else moves

Return ONLY the prompt text — no explanation, no JSON, no markdown.`;

    } else {
      // Single room fresh staging
      userPrompt = `Analyze this vacant real estate listing photo and generate a virtual staging prompt for an MLS listing.

MANDATORY: Your prompt MUST open with PRESERVE EXACTLY. Scan the photo and list every permanent element — cabinetry (exact color and style), countertop material, flooring, wall color, all installed fixtures, tile, appliances, mirrors, windows, trim, fireplace, island geometry. Every item in PRESERVE EXACTLY tells the staging engine it cannot touch that element.

SESSION PARAMETERS:
- Room: ${roomName} (Decor8 room type: ${roomType})
- Design Style: ${designStyle}
- Color Palette: ${colorPalette}
- Target Buyer: ${buyerProfile}
- Desired Feeling: ${desiredFeeling}
- Staging Intensity: ${stagingIntensity}
- MLS Mode: ${mlsMode ? 'YES — photorealistic, architecturally accurate' : 'Standard'}
${shotFocus ? `- Shot Focus: ${shotFocus}` : ''}
${adjacentRooms?.length ? `- Adjacent Rooms Visible: ${adjacentRooms.join(', ')}` : ''}
${anchorDNA && dnaTier === 'style' ? `- STYLE CONTINUITY (same home — different room):
${anchorDNA}
Do NOT replicate the living/dining furniture. Use appropriate furniture for this room type.
MATCH ONLY: wood tones, metal finishes, color palette, accessory density and restraint.` : ''}

ANALYZE THE PHOTO AND IDENTIFY:
1. Camera position and direction
2. Room focal point (fireplace, view, feature wall)
3. Island/peninsula orientation — which side faces camera vs away
4. All empty floor zones where furniture can go
5. All permanent fixtures that must be preserved exactly
6. Visible adjacent spaces that need appropriate (not overstaged) treatment
7. Natural light direction and quality

GENERATE A STAGING PROMPT that specifies:
- Exact furniture pieces and their precise placement locations
- Which side of islands/peninsulas bar seating goes (always far side from camera)
- Sofa orientation relative to focal point
- Area rug sizing and position
- Art placement with size guidance
- Props (minimal — follow props standards)
- What to preserve exactly
- What adjacent visible spaces should look like (understaged background)

Return ONLY the staging prompt text — no explanation, no JSON, no preamble.`;
    }

    const payload = JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: imageBase64 ? [
          { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 } },
          { type: "text", text: userPrompt }
        ] : [{ type: "text", text: userPrompt }]
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
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Claude prompt generation failed" }) };
    }

    const prompt = result.body?.content?.[0]?.text?.trim();
    if (!prompt) return { statusCode: 500, headers, body: JSON.stringify({ error: "No prompt returned" }) };

    console.log("Single room prompt:", prompt.length, "chars");
    return { statusCode: 200, headers, body: JSON.stringify({ prompt }) };

  } catch (err) {
    console.error("generate-staging-prompt error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
