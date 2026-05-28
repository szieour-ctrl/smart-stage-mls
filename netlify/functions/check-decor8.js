// Polling endpoint — client calls this every 3s to check job status
// Returns: {status: "pending"} | {status: "done", stagedBase64} | {status: "error", error}

const https = require("https");

async function getResult(jobId, token, siteId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.netlify.com",
      path: `/api/v1/sites/${siteId}/blobs/${encodeURIComponent("job-" + jobId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    }, (res) => {
      console.log(`Blob GET status: ${res.statusCode} for key: job-${jobId}`);
      if (res.statusCode === 404) { resolve(null); return; }
      // Handle redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        console.log(`Blob redirect to: ${loc?.slice(0,60)}`);
        https.request(new URL(loc), (res2) => {
          const chunks = [];
          res2.on("data", c => chunks.push(c));
          res2.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            console.log(`Blob redirect body size: ${raw.length} chars`);
            try { resolve(JSON.parse(raw)); }
            catch(e) { console.error("Blob parse error:", e.message); resolve(null); }
          });
        }).on("error", reject).end();
        return;
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        console.log(`Blob direct body size: ${raw.length} chars`);
        try { resolve(JSON.parse(raw)); }
        catch(e) { console.error("Blob parse error:", e.message); resolve(null); }
      });
    });
    req.on("error", reject);
    req.end();
  });
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
