// check-openai.js — Polling endpoint for OpenAI background jobs
// Uses @netlify/blobs SDK — separate from check-decor8 to preserve Decor8 flow
// Returns: {status: "pending"} | {status: "done", stagedBase64} | {status: "error", error}

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing jobId" }) };

  try {
    const store = getStore("staging-jobs");
    const result = await store.get("job-" + jobId, { type: "json" });
    console.log(`check-openai: jobId=${jobId} result=${result ? result.status : 'null'}`);
    if (!result) return { statusCode: 200, headers, body: JSON.stringify({ status: "pending" }) };
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error("check-openai error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
