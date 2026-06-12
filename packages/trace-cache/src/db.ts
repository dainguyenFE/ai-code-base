import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SCHEMA_SQL } from "./schema.js";

export type TraceDatabase = Database;

function migrate(db: TraceDatabase): void {
  const columns = db.query(`PRAGMA table_info(files)`).all() as {
    name: string;
  }[];

  if (!columns.some((column) => column.name === "parsed_json")) {
    db.exec(`ALTER TABLE files ADD COLUMN parsed_json TEXT`);
  }
}

export function openDatabase(dbPath: string): TraceDatabase {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}
