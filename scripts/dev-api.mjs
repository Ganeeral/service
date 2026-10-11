import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
const build = spawn(process.execPath, [compiler, "-p", "tsconfig.json"], {
  stdio: "inherit",
});
build.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const children = [
    spawn(
      process.execPath,
      [compiler, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
      { stdio: "inherit" },
    ),
    spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "--watch", "dist/main.js"],
      { stdio: "inherit" },
    ),
  ];
  const stop = () => children.forEach((child) => child.kill("SIGTERM"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  children.forEach((child) =>
    child.on("exit", (exitCode, signal) => {
      if (!signal) {
        stop();
        process.exit(exitCode ?? 1);
      }
    }),
  );
});
