const sm2 = require("sm-crypto").sm2;
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const BASE = "xiaozhi-esp32-server-web";
const PORT = 8002;
const PK = "0473afba64bf5e930cdaba316a204056482b61263bc9b1ae2e5a6897da35897eb61e2db3faf66560eb7b67da74b85ce506326e3131f02ddf53f9b7206d1e2b498f";

function httpReq(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: BASE, port: PORT, path, method,
      headers: Object.assign({}, headers || {}, data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {})
    };
    const req = http.request(opts, (res) => {
      let b = "";
      res.on("data", (c) => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Step 1: Get captcha for login
  const uuid = crypto.randomUUID();
  const captchaResp = await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  console.log("Captcha fetched, UUID:", uuid);
  
  // Step 2: Try login without captcha first
  const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
  
  console.log("\n--- Login attempt (no captcha) ---");
  const r1 = await httpReq("POST", "/xiaozhi/user/login", {
    username: "admin", password: encPw
  });
  console.log("Result:", r1.body);
  
  console.log("\n--- Login attempt (with empty captcha) ---");
  const r2 = await httpReq("POST", "/xiaozhi/user/login", {
    username: "admin", password: encPw, captchaId: uuid, captchaCode: ""
  });
  console.log("Result:", r2.body);

  // Check if login requires captcha
  const parsed = JSON.parse(r1.body);
  if (parsed.code === 0 && parsed.data) {
    console.log("\nLOGIN SUCCESS! Token:", parsed.data.substring(0, 50) + "...");
    fs.writeFileSync("/tmp/admin_token.txt", parsed.data);
    
    // Get user info
    const info = await httpReq("GET", "/xiaozhi/user/info", null, {
      "Authorization": parsed.data
    });
    console.log("User info:", info.body);
  } else {
    console.log("\nLogin failed. May need captcha or password hash format is different.");
    console.log("Trying plain password (no SM2 encryption)...");
    
    const r3 = await httpReq("POST", "/xiaozhi/user/login", {
      username: "admin", password: "Admin123456"
    });
    console.log("Plain password result:", r3.body);
  }
}

main().catch(console.error);
