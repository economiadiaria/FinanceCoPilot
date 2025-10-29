import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";

import * as schema from "./schema";

export type Database = PgDatabase<any, typeof schema>;

let dbInstance: Database | undefined;

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function getDb(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurado");
  }

  const client = neon(connectionString);
  dbInstance = drizzle(client, { schema }) as Database;
  return dbInstance;
}

export function setDbProvider(database: Database | undefined): void {
  dbInstance = database;
}
