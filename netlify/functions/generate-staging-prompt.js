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
    const {
      imageBase64, mimeType,
      roomName, roomType, openPlanZones,
      designStyle, colorPalette,
      buyerProfile, desiredFeeling,
      stagingIntensity, mlsMode,
      iterationNote, priorStagingDescription,
      shotFocus, adjacentRooms,
      anchorDNA, stagingDNA, dnaTier,
    } = JSON.parse(event.body);

    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }) };

    // ── Build the consultant prompt ───────────────────────────────────────────
    const isIteration = !!(iterationNote && priorStagingDescription);

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

The AI staging engine may ONLY add furniture, rugs, art, and soft accessories into empty space. It may NOT remodel, replace, recolor, or alter any existing permanent element. Always write PRESERVE EXACTLY first in every prompt before any styling instruction.

STAGING SCOPE — ADDITIONS INTO EMPTY SPACE ONLY:
Furniture, area rugs, wall art, minimal accessories, soft goods (pillows, throws, towels, bath mats).

PROPS STANDARDS:
- Countertops: max one tray or bowl, one vase, one plant per surface section
- Wall art: one piece per wall, sized 50-75% of furniture width below it
- Area rugs: one per seating area, front legs of all seating on rug
- Plants: maximum one per room. Less is more — every item must earn its place`;

    let userPrompt;

    if (isIteration) {
      // ── ITERATION MODE ────────────────────────────────────────────────────
      userPrompt = `You are revising a virtual staging result for an MLS listing photo.

MLS PRESERVE LAW — MANDATORY: Begin your prompt with PRESERVE EXACTLY, listing every permanent element visible in the original photo (cabinetry color/style, countertops, flooring, walls, fixtures, tile, appliances, mirrors, windows, trim). These MUST NOT change. Only furniture, rugs, art, and soft accessories may be added or adjusted.

CURRENT STAGING: ${priorStagingDescription}

REVISION REQUESTED: ${iterationNote}

ROOM: ${roomName} | STYLE: ${designStyle} | PALETTE: ${colorPalette} | BUYER: ${buyerProfile}
${anchorDNA ? `DESIGN CONTINUITY (match this): ${anchorDNA}` : ''}

Analyze both images carefully. Generate a revised staging prompt that:
1. Opens with PRESERVE EXACTLY — every permanent architectural element in the original photo
2. Keeps EVERYTHING from the current staging EXCEPT what the revision requests
3. Makes ONLY the specific changes requested — nothing else moves

Return ONLY the prompt text — no explanation, no JSON, no markdown. Just the staging prompt.`;

    } else {
      // ── FRESH STAGING MODE ────────────────────────────────────────────────
      userPrompt = `Analyze this vacant real estate listing photo and generate a virtual staging prompt for an MLS listing.

MANDATORY: Your prompt MUST open with a PRESERVE EXACTLY block. Scan the photo carefully and list every permanent element you see — cabinetry (exact color and style), countertop material and color, flooring, wall color, all installed fixtures, tile, appliances, mirrors, windows, trim, fireplace, island geometry, exterior materials. Every item in PRESERVE EXACTLY tells the staging engine it cannot touch that element. This protects the listing from MLS compliance violations.

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
${openPlanZones ? `- OPEN PLAN ZONES TO STAGE:\n${openPlanZones}` : ''}
${anchorDNA && dnaTier === 'full' ? `- OPEN PLAN FURNITURE DNA — MATCH EXACTLY:
${anchorDNA}
- Sofa: ${stagingDNA?.sofa || 'match open plan'}
- Dining set: ${stagingDNA?.diningTable || 'match open plan'} with ${stagingDNA?.diningChairs || 'matching chairs'}
- Bar stools: ${stagingDNA?.barStools || 'match open plan style'}
- Area rug: ${stagingDNA?.areaRug || 'match open plan'}
- Wood tones: ${stagingDNA?.woodTones || 'match open plan'}
- Metal finishes: ${stagingDNA?.metalFinishes || 'match open plan'}
- Color palette: ${Array.isArray(stagingDNA?.colorPalette)?stagingDNA.colorPalette.join(', '):(stagingDNA?.colorPalette||'match open plan')}` : ''}
${anchorDNA && dnaTier === 'style' ? `- STYLE CONTINUITY (same home — different room):
${anchorDNA}
Do NOT replicate the living/dining furniture. Use appropriate furniture for this room type.
MATCH ONLY: wood tones, metal finishes, color palette, accessory density and restraint.` : ''}

${openPlanZones ? `
OPEN PLAN PROMPT — ALL 10 RULES MUST BE FOLLOWED:

IMPORTANT API BEHAVIOR: When a custom prompt is sent to Decor8, room_type/design_style/color_scheme are stripped from the request. Your prompt must be fully self-contained and carry ALL information Decor8 needs.

STEP 1 — SCAN THE PHOTO AND IDENTIFY:
- Every permanent architectural fixture (for PRESERVE block)
- Which anchor fixtures are visible: fireplace? chandelier? kitchen island? ceiling fan? windows?
- Which zones are present based ONLY on what you can see
- Which side of the island faces the camera (near) vs away (far)

STEP 2 — GENERATE THE PROMPT in this exact order. Do not reorder. Do not skip sections.

SECTION A — GLOBAL SPACE DEFINITION (one sentence):
"Open-concept [name the zones you actually see — e.g. living, dining, and kitchen] space with connected architecture, shared flooring, and unified ceiling."

SECTION B — PRESERVATION (comprehensive list):
"Preserve all original architecture, room dimensions, wall placement, windows, cabinetry, appliances, ceiling height, flooring layout, and camera perspective."
Then list every permanent element you see — exact colors, materials, finishes. Cabinetry color/style, countertop material, flooring, fireplace surround, ALL ceiling fixtures (chandelier location, pendant locations, ceiling fan location), windows, appliances, island geometry and base color, tile, hardware. If island is visible: "DO NOT remove or relocate the kitchen island."

SECTION C — GLOBAL STYLE (one paragraph, before any zone instructions):
"Create cohesive ${designStyle} staging with ${colorPalette} tones, proportional furniture sizing appropriate for a large open-concept space, and unified material language throughout all connected zones."
${anchorDNA && dnaTier === 'full' ? `DNA from anchor staging — match these established choices: ${anchorDNA}` : ''}

SECTION D — ZONE INSTRUCTIONS (Living first, then Dining, then Kitchen):
Write ONLY zones you can actually see. Use ONLY fixture anchors visible in the photo.

Living zone (write ONLY if fireplace is visible):
"Living room zone: Define the seating area at the fireplace wall using a large natural fiber area rug positioned approximately 1 foot away from the fireplace wall. Place a seating grouping centered on the rug facing the fireplace with proportional furniture. Maintain realistic circulation around all furniture."

Dining zone (write ONLY if chandelier is visible):
"Dining zone: Define the dining area using a large woven oval rug centered directly beneath the hanging chandelier. Place a dining table with chairs centered on the rug with proper spacing and natural traffic flow around the table."

Kitchen zone (write ONLY if island is visible):
"Kitchen zone: Add counter stools on the far side of the island only — NOT the camera-facing side. Minimal countertop styling only — one small plant or bowl, nothing more."

SECTION E — CIRCULATION + REALISM (required):
"Maintain realistic scale, open circulation paths between all connected zones, and visual continuity throughout the space. Lighting should remain natural and consistent with the original image. MLS-photorealistic rendering with accurate furniture proportions and no architectural modifications."

SECTION F — NEGATIVE PROMPT (always last):
"Do not alter walls, windows, cabinetry, flooring layout, ceiling structure, fireplace dimensions, lighting fixtures, appliances, room proportions, or camera perspective. ${
  stagingDNA?.colorPalette ?
  `Palette must stay within: ${Array.isArray(stagingDNA.colorPalette) ? stagingDNA.colorPalette.join(', ') : stagingDNA.colorPalette}.` :
  `Avoid dark stained wood, cognac leather, black metal furniture frames, traditional rug patterns, table lamps.`
} Avoid excessive furniture, oversized decor, clutter, distorted geometry, duplicate objects, unrealistic staging, warped rugs, floating furniture, or fantasy lighting."

Return ONLY the final prompt text — no section labels, no headers, no explanation. Write it as flowing paragraphs exactly as Decor8 will receive it. Sections A through F run together as one continuous prompt.` : `
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

The prompt must be detailed enough that the AI staging engine knows exactly where every piece goes.`}

Return ONLY the staging prompt text — no explanation, no JSON, no preamble. Start directly with the staging description.`;
    }

    const payload = JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: imageBase64 ? [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 }
          },
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

    console.log("Generated prompt length:", prompt.length, "chars");
    return { statusCode: 200, headers, body: JSON.stringify({ prompt }) };

  } catch (err) {
    console.error("generate-staging-prompt error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
