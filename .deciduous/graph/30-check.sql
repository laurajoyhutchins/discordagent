SELECT
  'deciduous-graph' AS check_name,
  (SELECT COUNT(*) FROM decision_nodes) AS node_count,
  (SELECT COUNT(*) FROM decision_edges) AS edge_count,
  (SELECT COUNT(*) FROM decision_nodes WHERE JSON_EXTRACT(metadata_json, '$.lifecycle') IN ('unresolved', 'incomplete')) AS unresolved_count;
