import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { BookingService, Status } from "./booking.service";
import { Config } from "./config";
import { Database } from "./database";
import { TelegramApi } from "./telegram-api";
import { TelegramService } from "./telegram.service";

async function main() {
  const config = new Config();
  const db = new Database(config);
  const service = new BookingService(db, config);
  const actor = { kind: "operator", id: "local-cli" } as const;
  const [command, ...args] = process.argv.slice(2);
  const flag = (value: string | undefined): boolean => {
    if (value !== "true" && value !== "false")
      throw new Error("Expected true or false");
    return value === "true";
  };
  try {
    switch (command) {
      case "bot-setup": {
        if (!config.telegramEnabled || !config.origin.startsWith("https://"))
          throw new Error(
            "Bot setup requires enabled bot and canonical HTTPS origin",
          );
        const api = new TelegramApi(config);
        const bot = await api.call("getMe", {});
        if (
          !bot ||
          typeof bot !== "object" ||
          !("username" in bot) ||
          typeof bot.username !== "string" ||
          bot.username.toLowerCase() !== config.botUsername.toLowerCase()
        )
          throw new Error("Bot username mismatch");
        await api.call("setWebhook", {
          url: `${config.origin}/api/v1/telegram/webhook`,
          secret_token: config.webhookSecret,
          allowed_updates: ["message", "callback_query"],
          max_connections: 1,
          drop_pending_updates: false,
        });
        console.log("Webhook configured; pending updates retained");
        break;
      }
      case "bot-status": {
        const data = await new TelegramApi(config).call("getWebhookInfo", {});
        if (!data || typeof data !== "object")
          throw new Error("Invalid webhook info");
        console.log(
          JSON.stringify({
            configured:
              "url" in data &&
              data.url === `${config.origin}/api/v1/telegram/webhook`,
            pendingUpdates:
              "pending_update_count" in data ? data.pending_update_count : null,
            lastErrorAt:
              "last_error_date" in data ? data.last_error_date : null,
          }),
        );
        break;
      }
      case "bot-drain":
        await new TelegramService(
          db,
          config,
          service,
          new TelegramApi(config),
        ).drain();
        console.log("One worker cycle completed");
        break;
      case "bot-failures":
        console.log(
          JSON.stringify(
            (
              await db.pool.query(
                "SELECT state,last_error_code,count(*) FROM telegram_messages WHERE state='failed' GROUP BY state,last_error_code",
              )
            ).rows,
          ),
        );
        console.log(
          JSON.stringify(
            (
              await db.pool.query(
                "SELECT update_id,attempts,last_error_code FROM telegram_updates WHERE processed_at IS NULL AND attempts>=8 ORDER BY update_id LIMIT 20",
              )
            ).rows,
          ),
        );
        break;
      case "bot-retry-update":
        if (!args[0] || !/^\d{1,16}$/.test(args[0]))
          throw new Error("Expected update ID");
        await db.pool.query(
          "UPDATE telegram_updates SET attempts=0,available_at=now(),last_error_code=NULL WHERE update_id=$1 AND processed_at IS NULL",
          [args[0]],
        );
        console.log("Update retry scheduled");
        break;
      case "migrate":
        await db.migrate();
        console.log("Migrations applied");
        break;
      case "service":
        await service.configureService(args[0], args[1], flag(args[2]), actor);
        console.log("Service updated");
        break;
      case "publish":
        console.log(
          JSON.stringify(
            await service.publishWindows(args[0], args[1], actor),
            null,
            2,
          ),
        );
        break;
      case "visibility":
        await service.setPublished(args[0], flag(args[1]), actor);
        console.log("Visibility updated");
        break;
      case "close-date":
        await service.closeDate(args[0], flag(args[1]), actor);
        console.log(
          "Date updated; reopening does not republish hidden windows",
        );
        break;
      case "manual": {
        if (!args[0])
          throw new Error("Expected private JSON input file and request key");
        const input: unknown = JSON.parse(await readFile(args[0], "utf8"));
        console.log(
          JSON.stringify(await service.submit(input, args[1], actor), null, 2),
        );
        break;
      }
      case "status":
        console.log(
          JSON.stringify(
            await service.changeStatus(
              args[0],
              args[1] as Status,
              Number(args[2]),
              actor,
              args[3],
            ),
            null,
            2,
          ),
        );
        break;
      case "move":
        console.log(
          JSON.stringify(
            await service.reschedule(
              args[0],
              args[1],
              Number(args[2]),
              actor,
              args[3],
            ),
            null,
            2,
          ),
        );
        break;
      default:
        throw new Error(
          "Commands: migrate | service KEY TITLE true/false | publish START END | visibility SLOT true/false | close-date DATE true/false | manual PRIVATE_JSON_FILE KEY | status ID STATUS REVISION [REASON] | move ID SLOT REVISION REASON",
        );
    }
  } finally {
    await db.onApplicationShutdown();
  }
}

main().catch((error: unknown) => {
  // Never log DB errors, payloads, connection strings or customer details.
  if (
    error instanceof Error &&
    "getResponse" in error &&
    typeof error.getResponse === "function"
  )
    console.error(error.getResponse());
  else
    console.error(
      "CLI failed. Check command arguments, configuration, database connectivity and migrations.",
    );
  process.exitCode = 1;
});
