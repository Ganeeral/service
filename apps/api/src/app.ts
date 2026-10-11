import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  Module,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { BookingService } from "./booking.service";
import { Config } from "./config";
import { Database } from "./database";
import { TelegramController, TelegramService } from "./telegram.service";
import { TelegramApi } from "./telegram-api";

@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parserStatus =
      error instanceof Error &&
      "status" in error &&
      (error.status === 400 || error.status === 413)
        ? error.status
        : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (parserStatus ?? 500);
    const detail = error instanceof HttpException ? error.getResponse() : null;
    const body: { code: string; field?: string } = {
      code:
        parserStatus === 400
          ? "INVALID_JSON"
          : parserStatus === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 500
              ? "INTERNAL_ERROR"
              : "HTTP_ERROR",
    };
    if (
      detail &&
      typeof detail === "object" &&
      "code" in detail &&
      typeof detail.code === "string"
    ) {
      body.code = detail.code;
      if ("field" in detail && typeof detail.field === "string")
        body.field = detail.field;
    }
    if (status === 500) console.error("API operation failed");
    response.status(status).json(body);
  }
}

@Controller("api/v1")
class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  @Get("health")
  async health() {
    await this.db.pool.query("SELECT 1");
    return { status: "ok" };
  }

  @Get("booking-options")
  options() {
    return this.booking.options();
  }

  @Get("slots")
  slots(@Query("date") date: unknown) {
    return this.booking.availability(date);
  }

  @Post("appointments")
  submit(
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.headers.origin !== this.config.origin)
      throw new HttpException({ code: "ORIGIN_NOT_ALLOWED" }, 403);
    if (!request.is("application/json"))
      throw new HttpException({ code: "JSON_REQUIRED" }, 415);
    response.status(200);
    return this.booking.submit(body, key);
  }
}

@Module({
  controllers: [BookingController, TelegramController],
  providers: [BookingService, Database, TelegramService, TelegramApi],
})
class BookingModule {}

export async function createApplication(config: Config) {
  const app = await NestFactory.create<NestExpressApplication>(
    {
      module: BookingModule,
      providers: [{ provide: Config, useValue: config }],
    },
    { bodyParser: false, logger: false },
  );
  app.use((_request: Request, response: Response, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.useBodyParser("json", { limit: "16kb" });
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  try {
    const migration = await app
      .get(Database)
      .pool.query(
        "SELECT version FROM schema_migrations WHERE version = 4 AND EXISTS (SELECT 1 FROM booking_settings WHERE singleton)",
      );
    if (!migration.rowCount) throw new Error("Missing migration 4/settings");
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
