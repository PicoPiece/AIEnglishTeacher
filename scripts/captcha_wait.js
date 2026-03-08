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

async function main() {
  // Delete existing user first
  console.log("Checking for existing users...");
  
  // Get captcha
  const uuid = crypto.randomUUID();
  const captchaResp = await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  
  fs.writeFileSync("/tmp/captcha_wait.gif", captchaResp.body);
  fs.writeFileSync("/tmp/captcha_wait_uuid.txt", uuid);
  console.log("Captcha saved. UUID:", uuid);
  console.log("Waiting for /tmp/captcha_answer.txt ...");
  
  // Poll for answer file
  const maxWait = 120;
  for (let i = 0; i < maxWait; i++) {
    if (fs.existsSync("/tmp/captcha_answer.txt")) {
      const code = fs.readFileSync("/tmp/captcha_answer.txt", "utf-8").trim();
      console.log("Got captcha answer:", code);
      
      // Submit registration
      const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
      const regResult = await httpReq("POST", "/xiaozhi/user/register", {
        username: "admin2",
        password: encPw,
        captchaId: uuid,
        captchaCode: code
      });
      console.log("Register result:", regResult.body.toString());
      
      // Also try login with existing admin user
      const uuid2 = crypto.randomUUID();
      await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid2}`);
      fs.writeFileSync("/tmp/captcha_wait2.gif", (await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid2}`)).body);
      
      const encPw2 = "04" + sm2.doEncrypt("Admin123456", PK, 1);
      
      // Try login with the provided captcha code too
      const loginResult = await httpReq("POST", "/xiaozhi/user/login", {
        username: "admin",
        password: encPw2,
        captchaId: uuid,
        captchaCode: code
      });
      console.log("Login result:", loginResult.body.toString());
      
      const parsed = JSON.parse(loginResult.body.toString());
      if (parsed.code === 0 && parsed.data) {
        fs.writeFileSync("/tmp/admin_token.txt", parsed.data);
        console.log("TOKEN SAVED to /tmp/admin_token.txt");
      }
      
      // Cleanup
      fs.unlinkSync("/tmp/captcha_answer.txt");
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
    if (i % 10 === 0 && i > 0) console.log(`Still waiting... ${i}s`);
  }
  console.log("Timeout waiting for captcha answer.");
}

main().catch(console.error);
