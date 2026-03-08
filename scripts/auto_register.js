const sm2 = require("sm-crypto").sm2;
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const BASE = "xiaozhi-esp32-server-web";
const PORT = 8002;
const PK = "0473afba64bf5e930cdaba316a204056482b61263bc9b1ae2e5a6897da35897eb61e2db3faf66560eb7b67da74b85ce506326e3131f02ddf53f9b7206d1e2b498f";

function httpReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE, port: PORT, path, method,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const uuid = crypto.randomUUID();
  console.log("1. Getting captcha, UUID:", uuid);
  
  const captchaResp = await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  fs.writeFileSync("/tmp/captcha_latest.gif", captchaResp.body);
  fs.writeFileSync("/tmp/captcha_latest_uuid.txt", uuid);
  console.log("   Captcha saved to /tmp/captcha_latest.gif");
  console.log("   UUID saved to /tmp/captcha_latest_uuid.txt");
  console.log("   Now download captcha, solve it, and run:");
  console.log("   node /tmp/submit_register.js <CAPTCHA_CODE>");
}

main().catch(console.error);
