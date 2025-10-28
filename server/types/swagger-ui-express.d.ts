declare module "swagger-ui-express" {
  import type { RequestHandler } from "express";

  export const serve: RequestHandler[];
  export const setup: (swaggerDoc: unknown, customOptions?: Record<string, unknown>) => RequestHandler;
}
