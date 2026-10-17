import fs from "node:fs";
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  console.log(f, b.readUInt32BE(16), "x", b.readUInt32BE(20));
}
