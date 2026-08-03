import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { renderAll } from './deciduous-projections.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const graphDir = join(root, '.deciduous', 'graph');
const databasePath = join(root, '.deciduous', 'deciduous.db');
const outputDir = join(root, 'docs', 'archaeology');

const nodeTypes = new Set([
  'goal',
  'option',
  'decision',
  'action',
  'outcome',
  'observation',
  'revisit',
]);
const statuses = new Set([
  'pending',
  'active',
  'completed',
  'rejected',
  'superseded',
]);
const edgeTypes = new Set([
  'leads_to',
  'chosen',
  'rejected',
  'requires',
  'blocks',
  'enables',
]);
const lifecycles = new Set([
  'active',
  'experimental',
  'proposed',
  'superseded',
  'rejected',
  'abandoned',
  'compatibility-only',
  'proof-of-concept',
  'unresolved',
  'incomplete',
]);
const requiredDistinctions = [
  'observation.thread-is-not-execution',
  'decision.internal-conversation-id',
  'decision.provider-session-separate',
  'observation.polls-are-not-universal-ledgers',
  'outcome.notifications-are-projections',
  'observation.restart-is-not-exactly-once',
  'observation.transport-auth-not-tool-authority',
  'outcome.public-not-production-ready',
];

function buildDatabase() {
  if (!existsSync(graphDir)) {
    throw new Error(`Missing graph directory: ${relative(root, graphDir)}`);
  }
  const fragments = readdirSync(graphDir)
    .filter((name) => name.endsWith('.sql') || name.endsWith('.sql.gz'))
    .sort();
  if (fragments.length === 0) throw new Error('No graph SQL fragments found');

  rmSync(databasePath, { force: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  for (const fragment of fragments) {
    const path = join(graphDir, fragment);
    const bytes = readFileSync(path);
    database.exec(fragment.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
  }
  const foreignKeyErrors = database
    .prepare('PRAGMA foreign_key_check;')
    .all();
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Foreign-key failure: ${JSON.stringify(foreignKeyErrors)}`);
  }
  return database;
}

function loadGraph(database) {
  const nodes = database
    .prepare(
      `SELECT id, change_id changeId, node_type nodeType, title, description,
              status, metadata_json metadataJson
         FROM decision_nodes ORDER BY id`,
    )
    .all()
    .map((node) => ({ ...node, metadata: JSON.parse(node.metadataJson) }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = database
    .prepare(
      `SELECT id, source_node_id sourceNodeId, target_node_id targetNodeId,
              edge_type edgeType, rationale
         FROM decision_edges ORDER BY id`,
    )
    .all()
    .map((edge) => ({
      ...edge,
      source: byId.get(edge.sourceNodeId),
      target: byId.get(edge.targetNodeId),
    }));
  return { nodes, edges };
}

function validate(graph) {
  const errors = [];
  const semanticIds = new Set();
  const edgeKeys = new Set();

  for (const node of graph.nodes) {
    if (!nodeTypes.has(node.nodeType)) {
      errors.push(`${node.changeId}: invalid node type`);
    }
    if (!statuses.has(node.status)) {
      errors.push(`${node.changeId}: invalid status`);
    }
    if (semanticIds.has(node.changeId)) {
      errors.push(`${node.changeId}: duplicate semantic ID`);
    }
    semanticIds.add(node.changeId);
    if (node.metadata.semantic_id !== node.changeId) {
      errors.push(`${node.changeId}: metadata ID mismatch`);
    }
    if (!lifecycles.has(node.metadata.lifecycle)) {
      errors.push(`${node.changeId}: invalid lifecycle`);
    }
    if (!node.metadata.arc || !node.metadata.kind) {
      errors.push(`${node.changeId}: missing arc or kind`);
    }
    if (!Array.isArray(node.metadata.evidence) || !node.metadata.evidence.length) {
      errors.push(`${node.changeId}: missing evidence`);
    }
    if (!Array.isArray(node.metadata.views) || !node.metadata.views.length) {
      errors.push(`${node.changeId}: missing projection membership`);
    }
    if (
      node.metadata.current &&
      !['active', 'experimental'].includes(node.metadata.lifecycle)
    ) {
      errors.push(`${node.changeId}: invalid current marker`);
    }
  }

  for (const edge of graph.edges) {
    if (!edge.source || !edge.target) errors.push(`edge ${edge.id}: endpoint`);
    if (!edgeTypes.has(edge.edgeType)) errors.push(`edge ${edge.id}: type`);
    if (edge.sourceNodeId === edge.targetNodeId) {
      errors.push(`edge ${edge.id}: self edge`);
    }
    const key = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.edgeType}`;
    if (edgeKeys.has(key)) errors.push(`edge ${edge.id}: duplicate`);
    edgeKeys.add(key);
  }

  const rootNode = graph.nodes.find(
    (node) => node.changeId === 'goal.private-discord-agent-workspace',
  );
  if (!rootNode) {
    errors.push('missing root goal');
  } else {
    const outgoing = new Map();
    for (const edge of graph.edges) {
      const targets = outgoing.get(edge.sourceNodeId) ?? [];
      targets.push(edge.targetNodeId);
      outgoing.set(edge.sourceNodeId, targets);
    }
    const visited = new Set([rootNode.id]);
    const queue = [rootNode.id];
    while (queue.length) {
      const current = queue.shift();
      for (const target of outgoing.get(current) ?? []) {
        if (!visited.has(target)) {
          visited.add(target);
          queue.push(target);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) errors.push(`${node.changeId}: unreachable`);
    }
  }

  for (const changeId of requiredDistinctions) {
    if (!semanticIds.has(changeId)) errors.push(`missing ${changeId}`);
  }
  if (errors.length) {
    throw new Error(`Deciduous validation failed:\n- ${errors.join('\n- ')}`);
  }
  return { nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
}

function writeOrCheck(rendered, check) {
  mkdirSync(outputDir, { recursive: true });
  const stale = [];
  for (const [name, content] of rendered) {
    const path = join(outputDir, name);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
        stale.push(relative(root, path));
      }
    } else {
      writeFileSync(path, content, 'utf8');
    }
  }
  if (stale.length) {
    throw new Error(
      `Generated projections are stale:\n- ${stale.join(
        '\n- ',
      )}\nRun npm run deciduous:generate.`,
    );
  }
}

function main() {
  const command = process.argv[2] ?? 'check';
  if (!['generate', 'project', 'validate', 'check'].includes(command)) {
    throw new Error('Expected generate, project, validate, or check');
  }
  const database = buildDatabase();
  try {
    const graph = loadGraph(database);
    const counts = validate(graph);
    const rendered = renderAll(graph, counts);
    if (command === 'generate' || command === 'project') {
      writeOrCheck(rendered, false);
    }
    if (command === 'check') writeOrCheck(rendered, true);
    console.log(
      `Deciduous ${command} passed: ${counts.nodeCount} nodes, ${counts.edgeCount} edges.`,
    );
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
