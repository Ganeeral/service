import "reflect-metadata";
import { createApplication } from "./app";
import { Config } from "./config";

async function main() {
  const config = new Config();
  const app = await createApplication(config);
  try {
    await app.listen(config.port, "127.0.0.1");
  } catch (error) {
    await app.close();
    throw error;
  }
  console.log(`API listening on http://127.0.0.1:${config.port}`);
}

main().catch(() => {
  console.error(
    "API startup failed. Check required configuration, PostgreSQL connectivity and migrations.",
  );
  process.exitCode = 1;
});
