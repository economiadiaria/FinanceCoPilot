import type { User, Client } from "@shared/schema";
import type { RequestLogger } from "../observability/logger";

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      clientContext?: Client;
      requestId?: string;
      logger?: RequestLogger;
    }
  }
}

export {};
