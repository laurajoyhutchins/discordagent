-- Canonical Discord Agent Deciduous archaeology graph.

-- Generated from repository evidence; edit this seed, then run npm run deciduous:generate.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS decision_edges;

DROP TABLE IF EXISTS decision_nodes;

CREATE TABLE decision_nodes (
  id INTEGER PRIMARY KEY,
  change_id TEXT NOT NULL UNIQUE,
  node_type TEXT NOT NULL CHECK (node_type IN ('goal','option','decision','action','outcome','observation','revisit')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','completed','rejected','superseded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE decision_edges (
  id INTEGER PRIMARY KEY,
  source_node_id INTEGER NOT NULL REFERENCES decision_nodes(id) ON DELETE CASCADE,
  target_node_id INTEGER NOT NULL REFERENCES decision_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('leads_to','chosen','rejected','requires','blocks','enables')),
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_node_id, target_node_id, edge_type)
);
