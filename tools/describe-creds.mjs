// Describe a credentials text file without revealing values: labels, value lengths, token shape.
import fs from "node:fs";
const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => l.trim());
for (const [i, line] of lines.entries()) {
  const m = line.match(/^\s*([^:=]{1,40})\s*[:=]\s*(.*)$/);
  const label = m ? m[1].trim() : "(no label)";
  const value = m ? m[2].trim() : line.trim();
  let shape = "text";
  if (/^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/.test(value)) shape = "github classic token";
  else if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(value)) shape = "github fine-grained token";
  else if (/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(value)) shape = `email (${value.replace(/^(.).*(@.*)$/, "$1***$2")})`;
  else if (/^https?:\/\//.test(value)) shape = `url (${value})`;
  else if (/^[A-Za-z0-9-]{1,39}$/.test(value) && label.toLowerCase().includes("user")) shape = `username (${value})`;
  console.log(`${i + 1}. label="${label}" value=${shape}, ${value.length} chars`);
}
