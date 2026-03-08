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
  const uuid = crypto.randomUUID();
  const captchaResp = await httpReq("GET", `/xiaozhi/user/captcha?uuid=${uuid}`);
  
  fs.writeFileSync("/tmp/login_captcha.gif", captchaResp.body);
  fs.writeFileSync("/tmp/login_uuid.txt", uuid);
  console.log("Captcha saved to /tmp/login_captcha.gif, UUID:", uuid);
  console.log("Waiting for /tmp/login_answer.txt ...");
  
  for (let i = 0; i < 120; i++) {
    if (fs.existsSync("/tmp/login_answer.txt")) {
      const code = fs.readFileSync("/tmp/login_answer.txt", "utf-8").trim();
      console.log("Got answer:", code);
      
      const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
      const result = await httpReq("POST", "/xiaozhi/user/login", {
        username: "admin",
        password: encPw,
        captchaId: uuid,
        captchaCode: code
      });
      
      const body = result.body.toString();
      console.log("Login result:", body);
      
      const parsed = JSON.parse(body);
      if (parsed.code === 0 && parsed.data) {
        fs.writeFileSync("/tmp/admin_token.txt", parsed.data);
        console.log("SUCCESS! Token saved to /tmp/admin_token.txt");
        
        // Get user info
        const info = await httpReq("GET", "/xiaozhi/user/info");
        console.log("User info:", info.body.toString());
      } else {
        console.log("Login failed:", parsed.msg);
      }
      
      fs.unlinkSync("/tmp/login_answer.txt");
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
    if (i % 15 === 0 && i > 0) console.log(`Waiting... ${i}s`);
  }
  console.log("Timeout.");
}

main().catch(console.error);
