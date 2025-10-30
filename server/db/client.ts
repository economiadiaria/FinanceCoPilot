import { neon } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle as nodePostgresDrizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";

import * as schema from "./schema";

export type Database = PgDatabase<any, typeof schema>;

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type SupportedDriver = "neon" | "pg";

type InitOptions = {
  connectionString?: string;
  driver?: SupportedDriver;
};

let dbInstance: Database | undefined;
let disposeInstance: (() => Promise<void>) | undefined;
let rememberedOptions: InitOptions | undefined;

function isLocalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function resolveDriver(connectionString: string, preferred?: SupportedDriver): SupportedDriver {
  const envDriver = (preferred ?? process.env.DATABASE_DRIVER)?.toLowerCase();
  if (envDriver === "pg" || envDriver === "neon") {
    return envDriver;
  }
  if (isLocalHost(connectionString)) {
    return "pg";
  }
  return "neon";
}

function createDb(options?: InitOptions): Database {
  const connectionString = options?.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurado");
  }

  const driver = resolveDriver(connectionString, options?.driver);

  if (driver === "pg") {
    const pool = new pg.Pool({ connectionString });
    disposeInstance = async () => {
      await pool.end();
    };
    dbInstance = nodePostgresDrizzle(pool, { schema }) as Database;
    return dbInstance;
  }

  const client = neon(connectionString);
  disposeInstance = async () => {
    const maybeClosable = client as unknown as { end?: () => Promise<void> | void };
    if (typeof maybeClosable.end === "function") {
      await maybeClosable.end();
    }
  };
  dbInstance = neonDrizzle(client as unknown as any, { schema }) as Database;
  return dbInstance;
}

export function initDb(options?: InitOptions): Database {
  rememberedOptions = options ?? rememberedOptions;
  if (dbInstance) {
    return dbInstance;
  }
  return createDb(rememberedOptions);
}

export function getDb(): Database {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  const dispose = disposeInstance;
  disposeInstance = undefined;
  dbInstance = undefined;
  if (dispose) {
    await dispose();
  }
}

export function setDbProvider(
  database: Database | undefined,
  disposer?: (() => Promise<void>) | void,
): void {
  dbInstance = database;
  disposeInstance = disposer
    ? async () => {
        await disposer();
      }
    : undefined;
}

export async function transaction<T>(
  handler: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(handler);
}
