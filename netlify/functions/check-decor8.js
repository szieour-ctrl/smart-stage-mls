// Polling endpoint — client calls this every 3s to check job status
// Returns: {status: "pending"} | {status: "done", stagedBase64} | {status: "error", error}
// Netlify Blobs API: GET /blobs/key returns metadata with a signed URL
// Must follow the signed URL to get actual blob content

const https = require("https");

function httpsGet(urlOrOptions) {
  return new Promise((resolve, reject) => {
    const req = https.request(urlOrOptions, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function getResult(jobId, token, siteId) {
  // Step 1: Get metadata envelope from Netlify Blobs API
  const metaRes = await httpsGet({
    hostname: "api.netlify.com",
    path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent("job-" + jobId)}`,
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log(`Blob meta status: ${metaRes.status} size: ${metaRes.body.length}`);
  if (metaRes.status === 404) return null;
  if (metaRes.status !== 200) return null;

  let meta;
  try { meta = JSON.parse(metaRes.body); }
  catch(e) { console.error("Meta parse error:", e.message); return null; }

  console.log(`Meta keys: ${Object.keys(meta).join(',')}`);

  // If direct blob content (has status field) — return it
  if (meta.status) {
    console.log(`Direct content: status=${meta.status} stagedBase64=${meta.stagedBase64?.length||0}`);
    return meta;
  }

  // Metadata envelope — follow signed S3 URL to get actual content
  if (meta.url) {
    console.log(`Following S3 URL: ${meta.url.slice(0,80)}`);
    const s3Url = new URL(meta.url);
    const dataRes = await httpsGet({
      hostname: s3Url.hostname,
      path: s3Url.pathname + s3Url.search,
      method: "GET",
      headers: { "Accept": "*/*" }
    });
    console.log(`S3 response: ${dataRes.status} size: ${dataRes.body.length}`);
    if (dataRes.status !== 200) return null;
    try {
      const parsed = JSON.parse(dataRes.body);
      console.log(`S3 content: status=${parsed.status} stagedBase64=${parsed.stagedBase64?.length||0}`);
      return parsed;
    } catch(e) {
      console.error("S3 parse error:", e.message, "body:", dataRes.body.slice(0,100));
      return null;
    }
  }

  console.log("No status or url in meta — returning null");
  return null;
}

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing jobId" }) };

  const token = process.env.NETLIFY_ACCESS_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  console.log(`check-decor8: jobId=${jobId} siteId=${siteId ? siteId.slice(0,8)+'...' : 'MISSING'} token=${token ? 'present' : 'MISSING'}`);

  if (!token || !siteId) return { statusCode: 500, headers, body: JSON.stringify({ error: "Storage not configured" }) };

  try {
    const result = await getResult(jobId, token, siteId);
    if (!result) return { statusCode: 200, headers, body: JSON.stringify({ status: "pending" }) };
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error("check-decor8 error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
