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
  // Use ?raw=true to get blob content directly — avoids signed URL expiry issues
  const res = await httpsGet({
    hostname: "api.netlify.com",
    path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent("job-" + jobId)}?raw=true`,
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log(`Blob GET status: ${res.status} size: ${res.body.length}`);

  if (res.status === 404) return null;
  if (res.status !== 200) {
    console.log(`Blob error body: ${res.body.slice(0, 200)}`);
    return null;
  }

  try {
    const parsed = JSON.parse(res.body);
    console.log(`Blob status: ${parsed.status} stagedBase64 length: ${parsed.stagedBase64?.length || 0}`);
    return parsed;
  } catch(e) {
    console.error(`Blob parse error: ${e.message} body: ${res.body.slice(0, 200)}`);
    return null;
  }
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
