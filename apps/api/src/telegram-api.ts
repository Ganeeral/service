import { Injectable } from "@nestjs/common";
import { Config } from "./config";

export class TelegramError extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
    readonly retryAfter = 0,
  ) {
    super(code);
  }
}

@Injectable()
export class TelegramApi {
  constructor(private readonly config: Config) {}

  async call(
    method:
      | "sendMessage"
      | "answerCallbackQuery"
      | "setWebhook"
      | "getMe"
      | "getWebhookInfo",
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.config.telegramEnabled)
      throw new TelegramError("BOT_DISABLED", true);
    let response: Response;
    try {
      response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
    } catch {
      throw new TelegramError("TRANSPORT_ERROR", false);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TelegramError("INVALID_RESPONSE", false);
    }
    if (!body || typeof body !== "object" || !("ok" in body))
      throw new TelegramError("INVALID_RESPONSE", false);
    if (body.ok === true && response.ok && "result" in body) return body.result;
    const code =
      "error_code" in body && typeof body.error_code === "number"
        ? body.error_code
        : response.status;
    const parameters =
      "parameters" in body &&
      body.parameters &&
      typeof body.parameters === "object"
        ? body.parameters
        : null;
    const wait =
      parameters &&
      "retry_after" in parameters &&
      typeof parameters.retry_after === "number" &&
      Number.isSafeInteger(parameters.retry_after)
        ? Math.min(604800, Math.max(0, parameters.retry_after))
        : 0;
    throw new TelegramError(
      `TELEGRAM_${code}`,
      code >= 400 && code < 500 && code !== 429,
      wait,
    );
  }
}
