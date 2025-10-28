import type { User, Client } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      authUser?: User;
      clientContext?: Client;
    }
  }
}

export {};
