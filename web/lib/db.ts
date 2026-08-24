import { Pool } from "pg";

import { env } from "./env";

/**
 * A single shared pool.
 *
 * Cached on `globalThis` because Next.js re-evaluates modules on every hot
 * reload in development; without this, each edit would leak a new pool until
 * Postgres refused connections.
 */
const globalForDb = globalThis as unknown as { __deenPool?: Pool };

export const pool =
  globalForDb.__deenPool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__deenPool = pool;

export async function query<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Render a JS number array as a pgvector literal for `$n::vector`. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
