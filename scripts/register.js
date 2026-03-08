const sm2 = require("sm-crypto").sm2;
const http = require("http");
const crypto = require("crypto");

const BASE = "xiaozhi-esp32-server-web";
const PORT = 8002;
const PK = "0473afba64bf5e930cdaba316a204056482b61263bc9b1ae2e5a6897da35897eb61e2db3faf66560eb7b67da74b85ce506326e3131f02ddf53f9b7206d1e2b498f";

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: BASE, port: PORT, path }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    }).on("error", reject);
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: BASE, port: PORT, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, (res) => {
      let b = "";
      res.on("data", (c) => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Get captcha
  const uuid = crypto.randomUUID();
  console.log("Captcha UUID:", uuid);
  
  const captchaResp = await httpGet(`/xiaozhi/user/captcha?uuid=${uuid}`);
  console.log("Captcha status:", captchaResp.status);
  console.log("Captcha content-type:", captchaResp.headers["content-type"]);
  console.log("Captcha body length:", captchaResp.body.length);
  
  // Check if captcha body is JSON (might indicate captcha is disabled)
  const bodyStr = captchaResp.body.toString("utf-8");
  if (bodyStr.startsWith("{")) {
    console.log("Captcha response (JSON):", bodyStr);
  }
  
  // Step 2: Try register without captcha fields
  const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
  
  console.log("\n--- Attempt 1: No captcha fields ---");
  const r1 = await httpPost("/xiaozhi/user/register", { username: "admin", password: encPw });
  console.log("Result:", r1.body);

  console.log("\n--- Attempt 2: With captcha fields (empty code) ---");
  const r2 = await httpPost("/xiaozhi/user/register", { 
    username: "admin", password: encPw, captchaId: uuid, captchaCode: "" 
  });
  console.log("Result:", r2.body);

  console.log("\n--- Attempt 3: With captcha fields (random code) ---");
  const r3 = await httpPost("/xiaozhi/user/register", { 
    username: "admin", password: encPw, captchaId: uuid, captchaCode: "1234" 
  });
  console.log("Result:", r3.body);

  // Try brute force - captchas are usually 4 digits
  console.log("\n--- Attempting captcha brute force (4 digit codes) ---");
  for (let i = 0; i < 20; i++) {
    const newUuid = crypto.randomUUID();
    await httpGet(`/xiaozhi/user/captcha?uuid=${newUuid}`);
    // Try common/simple codes
    const codes = ["0000", "1111", "1234", "abcd"];
    const code = codes[i % codes.length];
    const newEncPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
    const r = await httpPost("/xiaozhi/user/register", {
      username: "admin", password: newEncPw, captchaId: newUuid, captchaCode: code
    });
    const parsed = JSON.parse(r.body);
    console.log(`Try ${i}: uuid=${newUuid.slice(0,8)}, code=${code}, result=${parsed.msg}`);
    if (parsed.code === 0) {
      console.log("SUCCESS!", r.body);
      return;
    }
  }
  
  console.log("\nCaptcha brute force failed. Captcha image needs to be solved manually.");
  console.log("Saving last captcha for inspection...");
  
  // Save captcha for manual solving
  const lastUuid = crypto.randomUUID();
  const lastCaptcha = await httpGet(`/xiaozhi/user/captcha?uuid=${lastUuid}`);
  require("fs").writeFileSync("/tmp/captcha_uuid.txt", lastUuid);
  require("fs").writeFileSync("/tmp/captcha.gif", lastCaptcha.body);
  console.log(`Captcha UUID saved to /tmp/captcha_uuid.txt: ${lastUuid}`);
  console.log("Captcha image saved to /tmp/captcha.gif");
}

main().catch(console.error);
