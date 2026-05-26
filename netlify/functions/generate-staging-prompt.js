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
function buildOpenPlanPrompt({ preserveList, chandelier, ceilingFan, designStyle, colorPalette, designDNA, openPlanStrategy, openPlanZones }) {

  // Strategy A — pure native Decor8, no custom prompt
  if (openPlanStrategy === 'native') return null;

  // Detect whether kitchen/island is in scope from the room label
  // "Open Plan: Dining + Great Room" = no kitchen zone, no island, no bar stools
  const labelLower = (openPlanZones || '').toLowerCase();
  const hasKitchen = labelLower.includes('kitchen') || labelLower.includes('island');

  // Resolve style and palette
  const rawStyle = designDNA?.overallStyle || designStyle || 'Organic Modern';
  const style = STYLE_LABELS[rawStyle?.toLowerCase().replace(/[^a-z]/g,'')] || rawStyle;
  const palette = colorPalette || 'warm neutrals';
  const paletteTones = PALETTE_TONES[palette] || `${palette} tones`;

  // Ceiling fixture anchors — Haiku provides fixture description (finish/style only,
  // no location language). Decor8 finds the fixture in the image itself.
  const diningAnchor  = chandelier  || 'the chandelier';
  const livingAnchor2 = ceilingFan  || 'the ceiling fan';

  // Strategies B and C use the same proven formula — C adds more sofa detail
  const sofaLine = openPlanStrategy === 'full'
    ? `Place a proportional sofa grouping, accent chairs, coffee table, and layered decor on the rug.`
    : `Place a proportional sofa grouping with accent chairs and a coffee table on the rug.`;

  return `PRESERVE EXACTLY: ${preserveList} NEVER MOVE, DELETE or REPLACE the following: Walls, Windows, FLOATING kitchen island base cabinet, Ceiling Fans, Chandeliers, Pendant Lighting, Fireplaces, Dishwashers, Refrigerators, Ranges or Cooktops.

Stage this open-concept ${hasKitchen ? 'living, dining, and kitchen' : 'living and dining'} space in ${style} design style using a ${palette} palette.

Stage with a high-end, airy look with balanced zone separation, intentional negative space, and open circulation throughout the connected ${hasKitchen ? 'living, dining, and FLOATING kitchen Island Cabinet' : 'living and dining areas'}.

Dining Zone:
Place a large oval area rug centered directly beneath ${diningAnchor}. Place a modern dining table with 6 chairs centered on the rug defining the dining zone. Keep clear circulation between the dining area and ${hasKitchen ? 'FLOATING kitchen island cabinet' : 'adjacent spaces'}.

Living Zone:
Place a large rectangular area rug in front of the fireplace wall centered beneath ${livingAnchor2}. ${sofaLine}

${hasKitchen ? `Kitchen Island:
Add 3 ${style} counter stools at the island with coordinated upholstery and metallic accents. Keep kitchen styling light and minimal. Do not remove, relocate, resize, or alter the kitchen island. Preserve the kitchen island, cabinetry, countertops, backsplash, and appliances exactly as shown.` : ''}

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
  "chandelier": "Identify the DINING chandelier — the decorative ceiling light fixture hanging over the dining/eating area, NOT pendant lights over a kitchen island or countertop. A chandelier hangs over open floor space where a dining table would go. A linear chandelier has multiple lights in a row on a horizontal bar. Describe ONLY its finish and style. Examples: 'the brushed nickel linear chandelier with clear glass shades', 'the gold 6-light round chandelier'. DO NOT include location words. If no chandelier is visible write 'the chandelier'.",
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

// ── DNA-DERIVED SINGLE ROOM PROMPT BUILDER ───────────────────────────────────
// Two-image Claude Opus call:
// Image 1: staged Open Plan anchor (Decor8 URL) → inventory Living/Dining zone
// Image 2: vacant single room photo (base64) → PRESERVE list + room anchors
// JS assembles final prompt using same anchor hierarchy as Open Plan
async function buildDNADerivedPrompt({ anchorImageUrl, vacantImageBase64, mimeType, derivedZone, roomName, designStyle, colorPalette, stagingDNA, claudeKey }) {

  const rawStyle = stagingDNA?.overallStyle || designStyle || 'Organic Modern';
  const style = STYLE_LABELS[rawStyle?.toLowerCase().replace(/[^a-z]/g,'')] || rawStyle;
  const palette = colorPalette || 'warm neutrals';
  const paletteTones = PALETTE_TONES[palette] || `${palette} tones`;

  const zoneLabel = derivedZone === 'living' ? 'Living Zone'
    : derivedZone === 'dining' ? 'Dining Zone'
    : 'Kitchen';

  const systemPrompt = `You are an expert MLS virtual staging consultant. You will receive two images:
IMAGE 1: A staged open plan living space — the anchor staging for this home.
IMAGE 2: A vacant single room from the same home.

Your job is to build a Decor8 virtual staging prompt that recreates the ${zoneLabel} inventory from Image 1 into the vacant room in Image 2, using the same anchor logic.

MLS PRESERVE LAW: The prompt must open with PRESERVE EXACTLY listing every permanent element from Image 2. Never alter architecture.`;

  const userPrompt = derivedZone === 'living' ? `
IMAGE 1 — Staged Open Plan (anchor):
Read the LIVING ZONE in this image and inventory every piece Decor8 placed:
- Primary sofa(s): count, fabric, color, profile
- Accent chairs: style, fabric, color, position
- Coffee table: material, shape, size
- Side tables: material, style
- Lamps: style, shade style
- Art above mantel: style, size, description
- Rug: shape, pattern, color, approximate size
- Pillows/throws: colors, textures
- Plants/accessories: type, placement

IMAGE 2 — Vacant Living Room:
Scan and identify:
- PRESERVE list: every permanent element with exact colors/materials
- Ceiling fan: finish and description
- Fireplace: surround color, firebox description
- Window wall: location and description
- Any other architectural anchors

BUILD THE DECOR8 PROMPT using this exact structure:

PRESERVE EXACTLY: [comprehensive list from Image 2 scan]

Stage this living room in ${style} style using a ${palette} palette.

Place a large rectangular [rug color/pattern from Image 1] area rug in front of the fireplace wall centered beneath [ceiling fan from Image 2].

[Primary sofa description from Image 1]: Place [count] [sofa description] centered on the rug.

[If secondary sofa]: Place one matching sofa [position] creating a conversation group.

[Coffee table from Image 1]: Place [description] centered on the rug between sofa and fireplace.

[Side tables + lamps from Image 1]: Place [description] flanking the sofa.

[Art from Image 1]: Mount [description] centered above the fireplace mantel.

[Accessories from Image 1]: [pillows, throws, plants, vase — exact descriptions].

Use ${style} furniture with clean architectural lines, refined materials, soft layered textures, and balanced upscale styling. Incorporate ${paletteTones} throughout pillows, rugs, artwork, and decor accents. Maintain open circulation and realistic furniture scale. Preserve all architectural features, room dimensions, lighting placement, flooring layout, and camera perspective exactly as photographed.

Return ONLY the final prompt text — no explanation, no preamble.`

  : derivedZone === 'dining' ? `
IMAGE 1 — Staged Open Plan (anchor):
Read the DINING ZONE in this image and inventory every piece Decor8 placed:
- Dining table: material, shape, size, finish
- Dining chairs: count, style, fabric, color
- Rug: shape, pattern, color, approximate size
- Centerpiece: description

IMAGE 2 — Vacant Dining Room:
Scan and identify:
- PRESERVE list: every permanent element
- Chandelier: finish and description
- Window wall: location
- Other anchors

BUILD THE DECOR8 PROMPT:

PRESERVE EXACTLY: [from Image 2]

Stage this dining room in ${style} style using a ${palette} palette.

Place a large [rug shape/pattern/color from Image 1] area rug centered beneath [chandelier from Image 2].

Place a [dining table description from Image 1] centered on the rug.

Place [chair count] [chair description from Image 1] around the table — [placement arrangement].

[Centerpiece from Image 1]: [description] on table center.

Use ${style} furniture with refined materials and balanced upscale styling. Incorporate ${paletteTones}. Preserve all architectural features exactly as photographed.

Return ONLY the final prompt text — no explanation, no preamble.`

  : `
IMAGE 1 — Staged Open Plan (anchor):
Read the KITCHEN zone and inventory counter accessory styling only:
- Bar stool style, seat material, frame material
- Counter accessories: bowls, vases, plants — exact descriptions

IMAGE 2 — Vacant Kitchen:
Scan and identify:
- PRESERVE list: every permanent element
- Island: base color, countertop, which side faces camera
- Pendant lights: finish and description

BUILD THE DECOR8 PROMPT:

PRESERVE EXACTLY: [from Image 2 — comprehensive list ending with DO NOT remove or relocate the kitchen island]

Stage this kitchen in ${style} style using a ${palette} palette.

Add 3 [bar stool description from Image 1] on the far side of the island only — NOT the camera-facing side.

Counter styling: [accessory descriptions from Image 1]. Keep all other surfaces completely clear.

Preserve the kitchen island, cabinetry, countertops, backsplash, and appliances exactly as shown. Do not remove, relocate, resize, or alter the kitchen island.

Use ${style} styling with ${paletteTones} accents. MLS-photorealistic. Preserve all architectural features exactly as photographed.

Return ONLY the final prompt text — no explanation, no preamble.`;

  const payload = JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: anchorImageUrl } },
        { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: vacantImageBase64 } },
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
    console.error("DNA-derived prompt error:", JSON.stringify(result.body).slice(0, 200));
    throw new Error("DNA-derived prompt generation failed");
  }

  const prompt = result.body?.content?.[0]?.text?.trim();
  if (!prompt) throw new Error("No DNA-derived prompt returned");

  console.log(`DNA-derived ${derivedZone} prompt: ${prompt.length} chars`);
  return prompt;
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
      anchorImageUrl, derivedZone,
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
        openPlanZones,
        designStyle,
        colorPalette,
        designDNA: stagingDNA,
        openPlanStrategy: openPlanStrategy || 'guided',
      });

      console.log("Open plan prompt built:", prompt ? `${prompt.length} chars` : "null (native)");
      return { statusCode: 200, headers, body: JSON.stringify({ prompt, metadata }) };
    }

    // ── DNA-DERIVED SINGLE ROOMS — two-image prompt build ────────────────────
    // Living Room, Great Room, Dining Room, Kitchen single angles
    // when Open Plan anchor image is available
    if (!isOpenPlan && !isIteration && anchorImageUrl && derivedZone) {
      console.log(`DNA-derived room: ${roomName} zone=${derivedZone} anchorUrl=${anchorImageUrl.slice(0,50)}`);
      const prompt = await buildDNADerivedPrompt({
        anchorImageUrl,
        vacantImageBase64: imageBase64,
        mimeType,
        derivedZone,
        roomName,
        designStyle,
        colorPalette,
        stagingDNA,
        claudeKey,
      });
      return { statusCode: 200, headers, body: JSON.stringify({ prompt }) };
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
