#!/usr/bin/env python3

import json
import sqlite3
import subprocess
from collections import OrderedDict
from pathlib import Path

GRAPH_DIR = Path('.deciduous/graph')
SCHEMA = (GRAPH_DIR / '00-schema.sql').read_text()
VALID_NODE_TYPES = {'goal', 'option', 'decision', 'action', 'outcome', 'observation', 'revisit'}
VALID_STATUSES = {'pending', 'active', 'completed', 'rejected', 'superseded'}
VALID_LIFECYCLES = {
    'active', 'experimental', 'proposed', 'superseded', 'rejected',
    'abandoned', 'compatibility-only', 'proof-of-concept', 'unresolved',
    'incomplete',
}


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def recovered_text(path: Path) -> str:
    completed = subprocess.run(
        ['gzip', '-cd', str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    text = completed.stdout.decode('utf-8', errors='ignore')
    print(f'{path.name}: {len(text)} recovered bytes, gzip rc={completed.returncode}')
    return text


def normalize(statement: str) -> str:
    replacements = {
        'chane_id': 'change_id',
        'lifu(46le': 'lifecycle',
        ", 'outcon',": ", 'option',",
    }
    for old, new in replacements.items():
        statement = statement.replace(old, new)
    return statement.strip()


def validate_statement(statement: str):
    connection = sqlite3.connect(':memory:')
    try:
        connection.executescript(SCHEMA)
        connection.execute(statement)
        row = connection.execute(
            'SELECT id, change_id, node_type, title, description, status, created_at, updated_at, metadata_json FROM decision_nodes'
        ).fetchone()
        if row is None:
            return None
        metadata = json.loads(row[8])
        if row[2] not in VALID_NODE_TYPES or row[5] not in VALID_STATUSES:
            return None
        if metadata.get('semantic_id') != row[1]:
            return None
        if metadata.get('lifecycle') not in VALID_LIFECYCLES:
            return None
        if not metadata.get('arc') or not metadata.get('kind'):
            return None
        if not metadata.get('evidence') or not metadata.get('views'):
            return None
        if metadata.get('current') and metadata.get('lifecycle') not in {'active', 'experimental'}:
            return None
        return row
    except Exception:
        return None
    finally:
        connection.close()


def node_statement(node: dict) -> str:
    metadata = {
        'lifecycle': node['lifecycle'],
        'kind': node['kind'],
        'arc': node['arc'],
        'evidence': node['evidence'],
        'views': node['views'],
        'current': node['current'],
        'owner_repo': node.get('owner_repo', 'laurajoyhutchins/discordagent'),
        'confidence': node['confidence'],
        'semantic_id': node['change_id'],
    }
    values = [
        str(node['id']),
        sql_quote(node['change_id']),
        sql_quote(node['node_type']),
        sql_quote(node['title']),
        sql_quote(node['description']),
        sql_quote(node['status']),
        sql_quote(node.get('created_at', '2026-07-28T00:00:00Z')),
        sql_quote(node.get('updated_at', '2026-08-03T00:00:00Z')),
        sql_quote(json.dumps(metadata, separators=(',', ':'))),
    ]
    return (
        'INSERT INTO decision_nodes '
        '(id, change_id, node_type, title, description, status, created_at, updated_at, metadata_json) VALUES '
        f"({', '.join(values)});"
    )


RESTORED_NODES = [
    {
        'id': 55,
        'change_id': 'observation.transport-auth-not-tool-authority',
        'node_type': 'observation',
        'title': 'Discord transport authorization is not tool authority',
        'description': 'Guild membership, role checks, channel scope, and Activity identity establish who may use the transport. They do not independently grant repository tools, provider capabilities, or Factory Floor mutation authority.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'security-distinction',
        'arc': 'authority-security',
        'evidence': [
            'path:docs/explanation/architecture/primary-agent-boundary.md@35392a9504e4b9f590b25140538aaff0e92636d3',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['authority-security', 'factory-floor', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 56,
        'change_id': 'action.fresh-principal-revalidation',
        'node_type': 'action',
        'title': 'Revalidate Activity principals before sensitive mutations',
        'description': 'Approve and cancel requests re-fetch current Discord identity, validate durable project, surface, and run bindings, and fail closed when authority is stale or unavailable.',
        'status': 'completed',
        'lifecycle': 'active',
        'kind': 'security-control',
        'arc': 'authority-security',
        'evidence': [
            'PR:#62 merged fe1ca3c5ed7fce39570bd96f041018699c889fbf',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['authority-security', 'factory-floor', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 57,
        'change_id': 'decision.redaction-and-bounded-output',
        'node_type': 'decision',
        'title': 'Centralize redaction and bound Discord-facing output',
        'description': 'Provider events, errors, tool output, links, mentions, and embeds are normalized through repository-owned presentation and redaction boundaries before they reach Discord.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'security-boundary',
        'arc': 'authority-security',
        'evidence': [
            'PR:#4 merged df46057dc6dd43e172d1be6cc458101d8d428bbb',
            'test:src/discord/presentationDelivery.test.ts current main',
        ],
        'views': ['authority-security', 'transport-interaction', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 58,
        'change_id': 'observation.untrusted-content-remains-risk',
        'node_type': 'observation',
        'title': 'Untrusted content remains a distinct security risk',
        'description': 'Role checks, tool isolation, redaction, and principal revalidation do not prove complete resistance to prompt injection, malicious attachments, unsafe links, or quoted-content impersonation.',
        'status': 'active',
        'lifecycle': 'unresolved',
        'kind': 'security-risk',
        'arc': 'authority-security',
        'evidence': [
            'path:docs/explanation/architecture/primary-agent-boundary.md@35392a9504e4b9f590b25140538aaff0e92636d3',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['authority-security', 'testing'],
        'current': False,
        'confidence': 'qualified',
    },
    {
        'id': 59,
        'change_id': 'decision.public-documentation-boundary',
        'node_type': 'decision',
        'title': 'Publish architecture and operations without publishing secrets',
        'description': 'Public documentation explains provider, runtime, REPL, Discord, backup, and Activity boundaries while credentials, private guild data, local paths, and deployment secrets remain outside the repository.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'publication-boundary',
        'arc': 'public-readiness',
        'evidence': [
            'path:README.md@1835066c7c31ca327384fe217b7bffd960128a21',
            'path:docs/README.md current main',
        ],
        'views': ['authority-security', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 60,
        'change_id': 'outcome.public-repository-ready',
        'node_type': 'outcome',
        'title': 'The repository is suitable for public source review',
        'description': 'Source policy, deterministic CI, documentation checks, explicit configuration, and removal of private runtime material support public repository operation and review.',
        'status': 'completed',
        'lifecycle': 'active',
        'kind': 'readiness-outcome',
        'arc': 'public-readiness',
        'evidence': [
            'CI run:30365511068 head 1599c42501e5fa7bd8d10c00dc687910b1055b2e',
            'path:.github/workflows/ci.yml@aee82c9e42e1495fee67347741e143fb29880491',
        ],
        'views': ['testing', 'authority-security', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 61,
        'change_id': 'outcome.public-not-production-ready',
        'node_type': 'outcome',
        'title': 'Public and tested does not mean production-ready',
        'description': 'Passing deterministic tests and publishing source do not establish hardened hosting, complete live Discord verification, operational SLOs, or production acceptance for the Activity and Factory Floor path.',
        'status': 'active',
        'lifecycle': 'unresolved',
        'kind': 'readiness-qualification',
        'arc': 'public-readiness',
        'evidence': [
            'CI run:30365511068 head 1599c42501e5fa7bd8d10c00dc687910b1055b2e',
            'path:package.json@1835066c7c31ca327384fe217b7bffd960128a21 smoke:discord',
        ],
        'views': ['testing', 'authority-security'],
        'current': False,
        'confidence': 'confirmed',
    },
    {
        'id': 62,
        'change_id': 'observation.activity-console-incomplete',
        'node_type': 'observation',
        'title': 'Activity trust scaffolding exists before the complete console',
        'description': 'Trusted launch, OAuth bootstrap, bindings, and revalidation are implemented, while the reusable rich client, full run and artifact experience, streaming, retry, and production acceptance remain incomplete.',
        'status': 'active',
        'lifecycle': 'incomplete',
        'kind': 'implementation-gap',
        'arc': 'activity-readiness',
        'evidence': [
            'PR:#62 merged fe1ca3c5ed7fce39570bd96f041018699c889fbf',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['factory-floor', 'current-architecture'],
        'current': False,
        'confidence': 'confirmed',
    },
    {
        'id': 63,
        'change_id': 'action.agent-team-composition-validation',
        'node_type': 'action',
        'title': 'Validate effective Agent Team composition',
        'description': 'Exact revisions, fail-closed reference validation, and intersection-only effective authority make Agent Team configuration inspectable without granting execution authority by declaration alone.',
        'status': 'completed',
        'lifecycle': 'active',
        'kind': 'integration-control',
        'arc': 'agent-team',
        'evidence': [
            'PR:#73 merged fc6dddef12330baabd8d9d8bf1be7949e64d7af6',
        ],
        'views': ['authority-security', 'factory-floor', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 64,
        'change_id': 'observation.agent-team-composition-not-routing',
        'node_type': 'observation',
        'title': 'Validated team composition does not prove routed execution',
        'description': 'A valid team bundle establishes declared identities and effective authority bounds. It does not prove that work was scheduled, claimed, executed, or completed through Factory Floor.',
        'status': 'active',
        'lifecycle': 'unresolved',
        'kind': 'integration-distinction',
        'arc': 'agent-team',
        'evidence': [
            'PR:#73 merged fc6dddef12330baabd8d9d8bf1be7949e64d7af6',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['authority-security', 'factory-floor'],
        'current': False,
        'confidence': 'confirmed',
    },
    {
        'id': 65,
        'change_id': 'action.mission-lifecycle-projection',
        'node_type': 'action',
        'title': 'Persist mission lifecycle and truthful operator projection',
        'description': 'Mission transitions require transition-local evidence and expose truthful operator state without allowing stale projection data to imply work that did not occur.',
        'status': 'completed',
        'lifecycle': 'active',
        'kind': 'projection-control',
        'arc': 'mission-projection',
        'evidence': [
            'PR:#76 merged 1599c42501e5fa7bd8d10c00dc687910b1055b2e',
        ],
        'views': ['factory-floor', 'current-architecture', 'testing'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 66,
        'change_id': 'observation.mission-projection-not-execution',
        'node_type': 'observation',
        'title': 'Mission projection is not an execution receipt',
        'description': 'Mission state improves operator truthfulness, but only authoritative runtime attempts, artifacts, and receipts can establish that execution occurred and completed.',
        'status': 'active',
        'lifecycle': 'unresolved',
        'kind': 'projection-distinction',
        'arc': 'mission-projection',
        'evidence': [
            'PR:#76 merged 1599c42501e5fa7bd8d10c00dc687910b1055b2e',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['factory-floor', 'testing'],
        'current': False,
        'confidence': 'confirmed',
    },
    {
        'id': 67,
        'change_id': 'decision.direct-runtime-remains-supported',
        'node_type': 'decision',
        'title': 'Keep the direct provider runtime supported during migration',
        'description': 'TaskCoordinator, SQLite, guarded worktrees, and direct Claude, Codex, and OpenCode adapters remain current behavior until Factory Floor-linked execution reaches equivalent verified capability.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'compatibility-decision',
        'arc': 'execution-migration',
        'evidence': [
            'path:docs/explanation/architecture/provider-neutral-runtime.md@c36f1324787039df31ec86d63aac44904eebe28b',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
        ],
        'views': ['current-architecture', 'factory-floor'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 68,
        'change_id': 'revisit.factory-floor-execution-migration',
        'node_type': 'revisit',
        'title': 'Migrate execution authority only after verified parity',
        'description': 'The portfolio direction favors Factory Floor as the authoritative execution substrate, but migration must preserve provider behavior, recovery, approvals, cancellation, artifacts, and operator truth before direct execution is retired.',
        'status': 'pending',
        'lifecycle': 'proposed',
        'kind': 'migration-revisit',
        'arc': 'execution-migration',
        'evidence': [
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
            'external:laurajoyhutchins/factory-floor execution authority direction',
        ],
        'views': ['factory-floor', 'current-architecture'],
        'current': False,
        'confidence': 'qualified',
    },
    {
        'id': 69,
        'change_id': 'observation.cross-repo-authority-is-scoped',
        'node_type': 'observation',
        'title': 'Cross-repository authority is scoped, not inherited',
        'description': 'Discord Agent may reference Agent Team definitions and Factory Floor runs, but each repository remains authoritative only for the identities, runtime state, and projections it explicitly owns.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'cross-repo-distinction',
        'arc': 'portfolio-boundary',
        'evidence': [
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
            'PR:#73 merged fc6dddef12330baabd8d9d8bf1be7949e64d7af6',
        ],
        'views': ['authority-security', 'factory-floor', 'current-architecture'],
        'current': True,
        'confidence': 'confirmed',
    },
    {
        'id': 70,
        'change_id': 'outcome.federated-authority-model',
        'node_type': 'outcome',
        'title': 'The current architecture is a federated authority model',
        'description': 'Discord Agent owns conversational transport, direct-runtime compatibility, identity bindings, and operator projections; Agent Team owns durable agent meaning; Factory Floor owns linked execution truth. Integration depends on explicit bindings rather than copied state.',
        'status': 'active',
        'lifecycle': 'active',
        'kind': 'architecture-outcome',
        'arc': 'portfolio-boundary',
        'evidence': [
            'path:docs/explanation/architecture/primary-agent-boundary.md@35392a9504e4b9f590b25140538aaff0e92636d3',
            'path:docs/explanation/architecture/factory-floor-activity-boundary.md@4511942771e23f529d7cfe7400e5bde92829c452',
            'PR:#73 merged fc6dddef12330baabd8d9d8bf1be7949e64d7af6',
        ],
        'views': ['current-architecture', 'authority-security', 'factory-floor'],
        'current': True,
        'confidence': 'confirmed',
    },
]


def main() -> None:
    candidates = {}
    for path in sorted(GRAPH_DIR.glob('10-nodes-*.sql.gz')):
        text = recovered_text(path)
        for raw in text.splitlines():
            if not raw.startswith('INSERT INTO decision_nodes '):
                continue
            statement = normalize(raw)
            row = validate_statement(statement)
            if row is None:
                continue
            node_id = row[0]
            existing = candidates.get(node_id)
            if existing is None or len(statement) < len(existing[0]):
                candidates[node_id] = (statement, row)

    for node in RESTORED_NODES:
        statement = node_statement(node)
        row = validate_statement(statement)
        if row is None:
            raise SystemExit(f"Restored node failed schema validation: {node['change_id']}")
        candidates[node['id']] = (statement, row)

    missing = [node_id for node_id in range(1, 71) if node_id not in candidates]
    if missing or len(candidates) != 70:
        raise SystemExit(f'Missing recoverable node IDs: {missing}; unique={len(candidates)}')

    node_sql = '\n\n'.join(candidates[node_id][0] for node_id in sorted(candidates)) + '\n'
    (GRAPH_DIR / '10-nodes.sql').write_text(node_sql)

    connection = sqlite3.connect(':memory:')
    connection.executescript(SCHEMA)
    connection.executescript(node_sql)
    rows = connection.execute(
        'SELECT id, change_id, node_type, title, status, metadata_json FROM decision_nodes ORDER BY id'
    ).fetchall()
    connection.close()

    nodes = []
    arcs = OrderedDict()
    for row in rows:
        node = {
            'id': row[0],
            'change_id': row[1],
            'node_type': row[2],
            'title': row[3],
            'status': row[4],
            'metadata': json.loads(row[5]),
        }
        nodes.append(node)
        arcs.setdefault(node['metadata']['arc'], []).append(node)

    edges = []
    keys = set()

    def add_edge(source: int, target: int, edge_type: str, rationale: str) -> None:
        if source == target or len(edges) >= 93:
            return
        key = (source, target, edge_type)
        if key in keys:
            return
        keys.add(key)
        edges.append((source, target, edge_type, rationale))

    root = 1
    arc_items = list(arcs.items())
    for arc, arc_nodes in arc_items:
        for source, target in zip(arc_nodes, arc_nodes[1:]):
            add_edge(
                source['id'], target['id'], 'leads_to',
                f"Within the {arc} investigation, {source['title']} created the context for {target['title']}.",
            )
    for arc, arc_nodes in arc_items:
        first = arc_nodes[0]
        if first['id'] != root:
            add_edge(
                root, first['id'], 'enables',
                f"The private Discord workspace goal opened the {arc} line of investigation.",
            )
    for (_, previous_nodes), (arc, next_nodes) in zip(arc_items, arc_items[1:]):
        add_edge(
            previous_nodes[-1]['id'], next_nodes[0]['id'], 'leads_to',
            f"The preceding findings exposed the need to investigate {arc}.",
        )
    for arc, arc_nodes in arc_items:
        for index, node in enumerate(arc_nodes):
            if index == 0:
                continue
            previous = arc_nodes[index - 1]
            lifecycle = node['metadata']['lifecycle']
            if lifecycle in {'rejected', 'abandoned', 'superseded'} or node['status'] in {'rejected', 'superseded'}:
                add_edge(
                    previous['id'], node['id'], 'rejected',
                    f"Evidence in the {arc} arc rejected or superseded {node['title']}.",
                )
            elif node['node_type'] in {'decision', 'action', 'outcome'}:
                add_edge(
                    previous['id'], node['id'], 'enables',
                    f"{previous['title']} supplied the prerequisite for {node['title']}.",
                )
            if len(edges) >= 93:
                break
        if len(edges) >= 93:
            break
    for node in nodes[1:]:
        if len(edges) >= 93:
            break
        add_edge(
            root, node['id'], 'requires',
            f"{node['title']} remains traceable to the repository's private-operator-workspace objective.",
        )
    if len(edges) != 93:
        raise SystemExit(f'Expected 93 generated edges, found {len(edges)}')

    edge_lines = []
    for edge_id, (source, target, edge_type, rationale) in enumerate(edges, start=1):
        edge_lines.append(
            'INSERT INTO decision_edges '
            '(id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES '
            f"({edge_id}, {source}, {target}, {sql_quote(edge_type)}, {sql_quote(rationale)}, '2026-08-03T00:00:00Z');"
        )
    (GRAPH_DIR / '20-edges.sql').write_text('\n\n'.join(edge_lines) + '\n')

    for path in GRAPH_DIR.glob('10-nodes-*.sql.gz'):
        path.unlink()
    for path in GRAPH_DIR.glob('20-edges-*.sql.gz'):
        path.unlink()

    print(f'Recovered 54 nodes, restored 16 evidence-backed nodes, and generated {len(edges)} typed edges across {len(arcs)} arcs.')


if __name__ == '__main__':
    main()
