import { overview, currentArchitecture, risks } from './deciduous-narratives.mjs';

export const maps = [
  ['transport-interaction', 'Discord transport and interaction model'],
  ['conversation-identity', 'Conversation identity map'],
  ['primary-subagents', 'Primary agent and subagent-thread evolution map'],
  ['repl', 'REPL evolution map'],
  ['testing', 'Testing and verification map'],
  ['factory-floor', 'Factory Floor integration boundary map'],
  ['authority-security', 'Authority and security boundary map'],
];

export function table(nodes) {
  const lines = [
    '| Semantic node | Type | Lifecycle | Current | Decision or outcome |',
    '|---|---|---|---:|---|',
  ];
  for (const node of nodes) {
    lines.push(
      `| \`${node.changeId}\` | ${node.nodeType} | ${node.metadata.lifecycle} | ${
        node.metadata.current ? 'yes' : ''
      } | ${node.title} |`,
    );
  }
  return lines.join('\n');
}

function mermaid(graph, view) {
  const nodes = graph.nodes.filter((node) => node.metadata.views.includes(view));
  const ids = new Set(nodes.map((node) => node.id));
  const aliases = new Map(nodes.map((node, index) => [node.id, `N${index + 1}`]));
  const lines = ['```mermaid', 'flowchart TD'];
  for (const node of nodes) {
    const label = `${node.title}\\n[${node.metadata.lifecycle}]`.replaceAll('"', "'");
    lines.push(`  ${aliases.get(node.id)}["${label}"]`);
  }
  for (const edge of graph.edges) {
    if (ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)) {
      lines.push(
        `  ${aliases.get(edge.sourceNodeId)} -->|${edge.edgeType}| ${aliases.get(
          edge.targetNodeId,
        )}`,
      );
    }
  }
  lines.push('```');
  return lines.join('\n');
}

function mapProjection(graph, view, title) {
  const nodes = graph.nodes.filter((node) => node.metadata.views.includes(view));
  return `# ${title}\n\nFiltered from the canonical graph. Nodes may appear in several maps when one decision affected multiple boundaries.\n\n${mermaid(
    graph,
    view,
  )}\n\n${table(nodes)}\n`;
}

export function renderAll(graph, counts) {
  const current = graph.nodes.filter((node) => node.metadata.current).length;
  const unresolved = graph.nodes.filter((node) =>
    ['unresolved', 'incomplete'].includes(node.metadata.lifecycle),
  ).length;
  const rendered = new Map([
    ['README.md', overview(counts, current, unresolved)],
    ['current-architecture.md', currentArchitecture(graph, counts)],
    ['risks-and-evidence.md', risks(graph)],
  ]);
  for (const [view, title] of maps) {
    rendered.set(`${view}.md`, mapProjection(graph, view, title));
  }
  return rendered;
}
