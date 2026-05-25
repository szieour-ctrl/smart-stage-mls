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

// ── STYLE LABEL MAP ──────────────────────────────────────────────────────────
const STYLE_LABELS = {
  'organicmodern':'Organic Modern','transitional':'Transitional','contemporary':'Contemporary',
  'modern':'Modern','scandinavian':'Scandinavian','minimalist':'Minimalist',
  'coastal':'Coastal','farmhouse':'Farmhouse','midcenturymodern':'Mid-Century Modern',
  'industrial':'Industrial','bohemian':'Bohemian','traditional':'Traditional',
  'japandi':'Japandi','warmminimalist':'Warm Minimalist','luxemodern':'Luxe Modern',
  'artdeco':'Art Deco','mediterranean':'Mediterranean','rustic':'Rustic',
  'grandmillennial':'Grand Millennial','wabi_sabi':'Wabi Sabi',
};

// ── PALETTE COLOR TONE MAP ────────────────────────────────────────────────────
// Maps palette label → accent color description for style injection sentence
const PALETTE_TONES = {
  'Warm Neutrals':    'warm cream, taupe, and honey tones',
  'Bright Airy':      'soft white, pale sage, and warm wood tones',
  'Soft Luxury':      'blue, gray, and champagne tones',
  'Cool Gray':        'cool gray, slate, and white tones',
  'Earth Tones':      'terracotta, rust, and warm brown tones',
  'Bold Contrast':    'black, white, and bold accent tones',
  'Coastal Blue':     'ocean blue, sandy neutral, and white tones',
  'Sage Green':       'sage green, warm white, and natural wood tones',
  'Jewel Tones':      'emerald, sapphire, and warm gold tones',
  'Desert Modern':    'sand, clay, and muted terracotta tones',
};

// ── OPEN PLAN PROMPT BUILDER ──────────────────────────────────────────────────
// Architecture: Claude Haiku reads photo → returns PRESERVE list + fixture names only
// JS assembles the final deterministic prompt from Sam's proven formula
// Anchor hierarchy: Walls → Ceiling Fixtures (chandelier/fan) → Fireplace Wall → Island
function buildOpenPlanPrompt({ preserveList, chandelier, ceilingFan, designStyle, colorPalette, designDNA, openPlanStrategy }) {

  // Strategy A — pure native Decor8, no custom prompt
  if (openPlanStrategy === 'native') return null;

  // Resolve style and palette
  const rawStyle = designDNA?.overallStyle || designStyle || 'Organic Modern';
  const style = STYLE_LABELS[rawStyle?.toLowerCase().replace(/[^a-z]/g,'')] || rawStyle;
  const palette = colorPalette || 'warm neutrals';
  const paletteTones = PALETTE_TONES[palette] || `${palette} tones`;

  // Ceiling fixture anchors — Haiku provides fixture description (finish/style only,
  // no location language). Decor8 finds the fixture in the image itself.
  const diningAnchor  = chandelier  || 'the chandelier';
  const livingAnchor2 = ceilingFan  || 'the ceiling fan';

  // Strategies B and C use the same proven formula — C adds the sofa instruction
  const sofaLine = openPlanStrategy === 'full'
    ? `Create a dominant living room seating arrangement facing the fireplace with a proportional sofa grouping, accent chairs, coffee table, and layered decor on the rug.`
    : `Create a proportional seating grouping facing the fireplace with accent chairs and a coffee table on the rug.`;

  return `PRESERVE EXACTLY: ${preserveList}

Stage this open-concept living, dining, and kitchen space in ${style} design style using a ${palette} palette.

Create a cohesive, high-end, airy look with balanced zone separation, intentional negative space, and open circulation throughout the connected living, dining, and kitchen areas.

Dining Zone:
Place a large oval area rug centered directly beneath ${diningAnchor}. Place a modern dining table with 6 chairs centered on the rug defining the dining zone. Keep clear circulation between the dining area and kitchen island.

Living Zone:
Place a large rectangular area rug in front of the fireplace wall centered beneath ${livingAnchor2}. ${sofaLine}

Kitchen Island:
Add 3 ${style} counter stools at the island with coordinated upholstery and metallic accents. Keep kitchen styling light and minimal. Do not remove, relocate, resize, or alter the kitchen island. Preserve the kitchen island, cabinetry, countertops, backsplash, and appliances exactly as shown.

Use ${style} furniture with clean architectural lines, refined materials, soft layered textures, metallic accents, and balanced upscale styling. Incorporate ${paletteTones} throughout pillows, rugs, artwork, and decor accents while maintaining a cohesive neutral foundation. Maintain open circulation, visual openness, and realistic furniture scale throughout the space. Preserve all architectural features, room dimensions, lighting placement, flooring layout, and camera perspective exactly as photographed.`;
}

// ── CLAUDE HAIKU — PRESERVE LIST + FIXTURE SCAN ONLY ─────────────────────────
// Claude's ONLY job: read the photo and return the PRESERVE list + fixture names.
// Zone anchors, rug shapes, zone order — ALL hardcoded in buildOpenPlanPrompt.
async function extractOpenPlanMetadata({ imageBase64, mimeType, claudeKey }) {
  const prompt = `You are scanning a real estate listing photo to extract preservation data for MLS virtual staging.
Return ONLY valid JSON — no markdown, no explanation, no preamble.

Scan this photo and return:

{
  "preserveList": "Comprehensive comma-separated list of every permanent architectural element visible. Be specific about exact colors and materials for each item: cabinetry color and door style, countertop material and color, flooring material and color, fireplace surround color and material, ALL ceiling fixtures with location and finish (e.g. 'brushed nickel 5-light chandelier center-right', 'brushed nickel ceiling fan far right'), ALL pendant lights with finish and location, windows with frame color, appliances with finish, island base color and countertop material, backsplash material, all doors and trim color. If kitchen island is visible end with: DO NOT remove or relocate the kitchen island.",
  "chandelier": "Describe ONLY the chandelier fixture itself — finish and style only. Example: 'the brushed nickel 5-light chandelier with clear glass shades'. DO NOT include any location, zone, or spatial reference words such as 'centered', 'above', 'in the living area', 'in the dining area', 'main area'. Fixture description only.",
  "ceilingFan": "Describe ONLY the ceiling fan fixture itself — finish and style only. Example: 'the brushed nickel ceiling fan'. DO NOT include any location, zone, or spatial reference words. Fixture description only.",
  "hasFireplace": true,
  "hasIsland": true
}`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 600,
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
  catch(e) { return { preserveList: "", chandelier: "the chandelier", ceilingFan: "the ceiling fan", hasFireplace: true, hasIsland: true }; }
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

      // Strategies B and C: Claude scans photo for PRESERVE list + fixture names only
      // Zone anchors, rug shapes, zone order are ALL hardcoded in buildOpenPlanPrompt
      console.log("Open plan: scanning photo for PRESERVE list + fixtures, strategy:", openPlanStrategy || 'guided');
      const metadata = await extractOpenPlanMetadata({ imageBase64, mimeType, claudeKey });

      const prompt = buildOpenPlanPrompt({
        preserveList: metadata.preserveList || '',
        chandelier:   metadata.chandelier   || 'the chandelier',
        ceilingFan:   metadata.ceilingFan   || 'the ceiling fan',
        designStyle,
        colorPalette,
        designDNA: stagingDNA,
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
