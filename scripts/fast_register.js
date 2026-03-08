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
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function tryRegister(captchaCode) {
  const uuid = crypto.randomUUID();
  await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  
  const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
  const result = await httpReq("POST", "/xiaozhi/user/register", {
    username: "admin",
    password: encPw,
    captchaId: uuid,
    captchaCode: captchaCode
  });
  return { uuid, result: JSON.parse(result.body.toString()) };
}

async function main() {
  // Step 1: Check pub-config to see if registration is allowed
  const pubConfig = await httpReq("GET", "/xiaozhi/user/pub-config");
  const config = JSON.parse(pubConfig.body.toString());
  console.log("allowUserRegister:", config.data.allowUserRegister);
  
  // Step 2: Try registration without captcha (maybe first user doesn't need it)
  const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
  
  console.log("\n--- Try 1: No captcha ---");
  const r1 = await httpReq("POST", "/xiaozhi/user/register", {
    username: "admin", password: encPw
  });
  console.log("Result:", r1.body.toString());
  
  console.log("\n--- Try 2: Empty captchaId ---");
  const r2 = await httpReq("POST", "/xiaozhi/user/register", {
    username: "admin", password: encPw, captchaId: "", captchaCode: ""
  });
  console.log("Result:", r2.body.toString());
  
  // Step 3: Get captcha and save for manual solving
  const uuid = crypto.randomUUID();
  const captchaResp = await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  fs.writeFileSync("/tmp/fast_captcha.gif", captchaResp.body);
  fs.writeFileSync("/tmp/fast_uuid.txt", uuid);
  
  console.log("\nCaptcha saved. UUID:", uuid);
  console.log("Polling /tmp/fast_answer.txt (timeout: 45s)...");
  
  for (let i = 0; i < 45; i++) {
    if (fs.existsSync("/tmp/fast_answer.txt")) {
      const code = fs.readFileSync("/tmp/fast_answer.txt", "utf-8").trim();
      console.log("Answer:", code, "at second:", i);
      
      const encPw2 = "04" + sm2.doEncrypt("Admin123456", PK, 1);
      const result = await httpReq("POST", "/xiaozhi/user/register", {
        username: "admin", password: encPw2, captchaId: uuid, captchaCode: code
      });
      const parsed = JSON.parse(result.body.toString());
      console.log("Register result:", JSON.stringify(parsed));
      
      if (parsed.code === 0) {
        console.log("SUCCESS! Token:", parsed.data);
        fs.writeFileSync("/tmp/admin_token.txt", parsed.data);
      }
      
      fs.unlinkSync("/tmp/fast_answer.txt");
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log("Timeout.");
}

main().catch(console.error);
