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
OPEN PLAN PROMPT — CRITICAL API BEHAVIOR:
When a custom prompt is sent to Decor8, room_type, design_style, color_scheme, and speciality_decor are ALL IGNORED. Your prompt must be fully self-contained — it must declare this is an open plan space, carry the style, palette, and furniture descriptions entirely within the prompt text.

ANALYZE THE PHOTO AND IDENTIFY:
1. Every permanent fixture visible — list each specifically for the PRESERVE block
2. Which side of the island faces the camera (near) vs away (far) — if island is present
3. What open floor zones are available for furniture placement

GENERATE A SELF-CONTAINED OPEN PLAN STAGING PROMPT structured exactly as follows:

OPENING LINE (required):
Start with: "Virtually stage this open plan [describe the two zones you see — e.g. living and dining area, or kitchen and living area] in [${designStyle}] style with [${colorPalette}] palette."

PRESERVE EXACTLY (required, list every item):
Every permanent architectural element visible in this photo. Be specific about colors and materials. If kitchen island is visible write: "DO NOT remove or relocate the kitchen island." List cabinetry color, countertop material, flooring, fireplace surround, ceiling fixtures, windows, appliances, tile — everything that exists in the original photo.

FURNITURE — describe each piece by what it looks like, NOT where to put it:
Decor8's openplan spatial model handles zone placement. Your job is describing materials and style only:
- Sofa: fabric type, color, profile, leg style — NO placement instructions
- Dining table: material, shape, finish — NO placement instructions  
- Dining chairs: style, material, seat — NO placement instructions
- Bar stools (if island visible): seat material, frame material — specify "far side of island only, NOT camera-facing side"
- Coffee table: material, shape, finish
- Area rug: texture, weave, color, approximate size
- Art: style description, dominant colors — NO wall placement instructions
- Plants: type, pot style — maximum one

PALETTE:
List 3-4 specific colors that must dominate. List 2-3 specific items that must NOT appear (e.g. "no dark stained wood, no traditional patterns, no table lamps").

ATMOSPHERE:
One sentence: lighting quality, mood, photorealism standard for MLS photography.

Return ONLY the prompt text — no section headers, no explanation, no preamble. Write it as a single flowing staging instruction that Decor8 receives directly.` : `
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
