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
  // Step 1: Get blob metadata — returns JSON with signed URL
  const metaRes = await httpsGet({
    hostname: "api.netlify.com",
    path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent("job-" + jobId)}`,
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log(`Blob meta status: ${metaRes.status} size: ${metaRes.body.length}`);

  if (metaRes.status === 404) return null;

  // Try parsing as direct JSON first (old blob format)
  try {
    const direct = JSON.parse(metaRes.body);
    if (direct.status) {
      console.log(`Direct blob status: ${direct.status} stagedBase64 length: ${direct.stagedBase64?.length || 0}`);
      return direct;
    }
    // If it has a url field, it's a metadata envelope — follow the URL
    if (direct.url) {
      console.log(`Following signed URL: ${direct.url.slice(0, 80)}`);
      const dataRes = await httpsGet(new URL(direct.url));
      console.log(`Signed URL response: ${dataRes.status} size: ${dataRes.body.length}`);
      return JSON.parse(dataRes.body);
    }
  } catch(e) {
    console.log(`Parse attempt failed: ${e.message} — body preview: ${metaRes.body.slice(0, 200)}`);
  }

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
