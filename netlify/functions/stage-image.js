const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { imageBase64, mimeType, stagingPrompt } = JSON.parse(event.body);

    if (!imageBase64 || !stagingPrompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing imageBase64 or stagingPrompt" }),
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "OpenAI API key not configured" }),
      };
    }

    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imageMime = mimeType || "image/jpeg";
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);

    const buildMultipart = () => {
      const parts = [];

      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-1`
      );
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${stagingPrompt}`
      );
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1`
      );
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024`
      );
      // NOTE: gpt-image-1 does NOT accept response_format — removed
      // output_format controls png vs webp
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng`
      );

      const textPart = parts.join("\r\n") + "\r\n";
      const textBuffer = Buffer.from(textPart, "utf8");

      const fileHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="room.jpg"\r\nContent-Type: ${imageMime}\r\n\r\n`,
        "utf8"
      );

      const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

      return Buffer.concat([textBuffer, fileHeader, imageBuffer, closing]);
    };

    const formData = buildMultipart();

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.openai.com",
        path: "/v1/images/edits",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": formData.length,
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: { raw: data } });
          }
        });
      });

      req.on("error", reject);
      req.write(formData);
      req.end();
    });

    if (result.status !== 200) {
      console.error("OpenAI error:", JSON.stringify(result.body));
      return {
        statusCode: result.status,
        headers,
        body: JSON.stringify({
          error: result.body?.error?.message || "OpenAI API error",
          details: result.body,
        }),
      };
    }

    // gpt-image-1 returns b64_json in data[0]
    const imageData = result.body?.data?.[0];
    const stagedBase64 = imageData?.b64_json;

    if (!stagedBase64) {
      console.error("Unexpected response:", JSON.stringify(result.body).slice(0, 400));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "No image data in OpenAI response",
          shape: JSON.stringify(result.body).slice(0, 300),
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ stagedBase64 }),
    };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
