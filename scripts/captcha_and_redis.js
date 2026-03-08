const http = require("http");
const crypto = require("crypto");
const { execSync } = require("child_process");

const uuid = crypto.randomUUID();
console.log("UUID:", uuid);

http.get({
  hostname: "xiaozhi-esp32-server-web",
  port: 8002,
  path: `/xiaozhi/user/captcha?uuid=${uuid}`
}, (res) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    require("fs").writeFileSync("/tmp/captcha_latest.gif", Buffer.concat(chunks));
    console.log("Captcha saved. Now checking Redis...");
    
    // Check all Redis keys after captcha generation
    try {
      const keys = execSync("redis-cli -h xiaozhi-esp32-server-redis KEYS '*'", { encoding: "utf-8" });
      console.log("All Redis keys after captcha:", keys);
      
      // Try to get any key that might contain the captcha
      const keyList = keys.trim().split("\n").filter(k => k);
      for (const key of keyList) {
        try {
          const type = execSync(`redis-cli -h xiaozhi-esp32-server-redis TYPE "${key}"`, { encoding: "utf-8" }).trim();
          console.log(`Key: ${key}, Type: ${type}`);
          if (type === "string") {
            const val = execSync(`redis-cli -h xiaozhi-esp32-server-redis GET "${key}"`, { encoding: "utf-8" }).trim();
            console.log(`  Value: ${val.substring(0, 200)}`);
          } else if (type === "hash") {
            const val = execSync(`redis-cli -h xiaozhi-esp32-server-redis HGETALL "${key}"`, { encoding: "utf-8" }).trim();
            console.log(`  Value: ${val.substring(0, 200)}`);
          }
        } catch (e) {}
      }
      
      // Also try the UUID directly
      const uuidVal = execSync(`redis-cli -h xiaozhi-esp32-server-redis GET "${uuid}"`, { encoding: "utf-8" }).trim();
      console.log(`UUID key value: "${uuidVal}"`);
      
      // Try common captcha key patterns
      const patterns = [`captcha:${uuid}`, `sys:captcha:${uuid}`, `CAPTCHA:${uuid}`, uuid];
      for (const p of patterns) {
        const v = execSync(`redis-cli -h xiaozhi-esp32-server-redis GET "${p}"`, { encoding: "utf-8" }).trim();
        if (v && v !== "(nil)") console.log(`Found! Key="${p}" Value="${v}"`);
      }
    } catch(e) {
      console.log("Redis check error:", e.message);
    }
  });
}).on("error", console.error);
