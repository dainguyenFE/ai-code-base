export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  language TEXT,
  hash TEXT NOT NULL,
  is_client_component INTEGER DEFAULT 0,
  is_server_component INTEGER DEFAULT 0,
  parsed_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,
  metadata_json TEXT,
  hash TEXT,
  FOREIGN KEY (file_id) REFERENCES files(id)
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  page_file TEXT,
  layout_files_json TEXT,
  loading_file TEXT,
  error_file TEXT,
  not_found_file TEXT,
  route_handler_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
`;
