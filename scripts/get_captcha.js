const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const uuid = crypto.randomUUID();
console.log("UUID:" + uuid);

http.get({
  hostname: "xiaozhi-esp32-server-web",
  port: 8002,
  path: `/xiaozhi/user/captcha?uuid=${uuid}`
}, (res) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    const buf = Buffer.concat(chunks);
    fs.writeFileSync("/tmp/captcha.gif", buf);
    fs.writeFileSync("/tmp/captcha_uuid.txt", uuid);
    console.log("Saved captcha.gif and uuid");
  });
}).on("error", console.error);
