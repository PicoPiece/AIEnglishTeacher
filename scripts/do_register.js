const sm2 = require("sm-crypto").sm2;
const http = require("http");
const fs = require("fs");

const PK = "0473afba64bf5e930cdaba316a204056482b61263bc9b1ae2e5a6897da35897eb61e2db3faf66560eb7b67da74b85ce506326e3131f02ddf53f9b7206d1e2b498f";
const captchaCode = process.argv[2];
const uuid = fs.readFileSync("/tmp/captcha_uuid.txt", "utf-8").trim();

if (!captchaCode) {
  console.log("Usage: node do_register.js <captcha_code>");
  process.exit(1);
}

console.log("UUID:", uuid);
console.log("Captcha code:", captchaCode);

const encPw = "04" + sm2.doEncrypt("Admin123456", PK, 1);
const data = JSON.stringify({
  username: "admin",
  password: encPw,
  captchaId: uuid,
  captchaCode: captchaCode
});

const req = http.request({
  hostname: "xiaozhi-esp32-server-web",
  port: 8002,
  path: "/xiaozhi/user/register",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
}, (res) => {
  let b = "";
  res.on("data", (c) => b += c);
  res.on("end", () => {
    console.log("Response:", b);
    const parsed = JSON.parse(b);
    if (parsed.code === 0) {
      console.log("REGISTRATION SUCCESSFUL!");
      if (parsed.data) console.log("Token:", parsed.data);
    }
  });
});

req.on("error", (e) => console.error("Error:", e.message));
req.write(data);
req.end();
