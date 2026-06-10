/**
 * Kills any process bound to port 3000, then launches webpack-dev-server.
 * This lets VS Code F5 work reliably even when the server is already running.
 */
"use strict";

const { execSync, spawn } = require("child_process");

function killPort(port) {
  try {
    if (process.platform === "win32") {
      // Find PIDs listening on the port and force-kill each one
      const raw = execSync(
        `netstat -ano | findstr ":${port} "`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      );
      const pids = new Set();
      raw.split("\n").forEach((line) => {
        if (/LISTENING/i.test(line)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
        }
      });
      pids.forEach((pid) => {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`Killed existing process on port ${port} (PID ${pid})`);
        } catch {}
      });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
        shell: true,
        stdio: "ignore",
      });
    }
  } catch {
    // No process was using the port — nothing to do
  }
}

killPort(3000);

// Brief pause so the OS releases the socket before we re-bind
setTimeout(() => {
  const proc = spawn(
    "npx",
    ["webpack", "serve", "--mode", "development", "--env", "mock"],
    { stdio: "inherit", shell: true }
  );
  proc.on("exit", (code) => process.exit(code ?? 0));
}, 400);
