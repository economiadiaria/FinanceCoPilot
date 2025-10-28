import type { User, Client, BankAccount } from "@shared/schema";
import type { RequestLogger } from "../observability/logger";

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      clientContext?: Client;
      bankAccountContext?: BankAccount;
      requestId?: string;
      logger?: RequestLogger;
    }
  }
}

export {};
