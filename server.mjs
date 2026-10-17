// PORT-aware production start for Railway: `next start` must bind the port Railway routes to.
import { spawn } from "node:child_process";

const port = process.env.PORT || "3000";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
