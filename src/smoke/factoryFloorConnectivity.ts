import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { FactoryFloorClient } from '../factoryFloor/client.js';

export interface FactoryFloorConnectivityResult {
  enabled: boolean;
  baseUrl?: string;
  status?: string;
  readyDeliveries?: number;
  activeExecutions?: number;
  pendingApprovals?: number;
}

export async function checkFactoryFloorConnectivity(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FactoryFloorConnectivityResult> {
  if (env.FACTORY_FLOOR_ENABLED !== 'true') return { enabled: false };
  const baseUrl = env.FACTORY_FLOOR_BASE_URL?.trim() || 'http://127.0.0.1:3000';
  const token = env.FACTORY_FLOOR_OPERATOR_TOKEN?.trim();
  if (!token) throw new Error('FACTORY_FLOOR_OPERATOR_TOKEN is required');
  const client = new FactoryFloorClient({
    baseUrl,
    operatorToken: token,
    timeoutMs: Number.parseInt(env.FACTORY_FLOOR_REQUEST_TIMEOUT_MS ?? '15000', 10),
  });
  const status = await client.getStatus('discord-agent:smoke');
  return {
    enabled: true,
    baseUrl,
    status: status.status,
    readyDeliveries: status.readyDeliveries,
    activeExecutions: status.activeExecutions,
    pendingApprovals: status.pendingApprovals,
  };
}

async function main(): Promise<void> {
  const result = await checkFactoryFloorConnectivity();
  if (!result.enabled) {
    console.log('SKIPPED — Factory Floor bridge is disabled.');
    return;
  }
  console.log(`✓ Factory Floor API: ${result.baseUrl}`);
  console.log(`✓ Control-plane status: ${result.status}`);
  console.log(`✓ Ready deliveries: ${result.readyDeliveries ?? 0}`);
  console.log(`✓ Active executions: ${result.activeExecutions ?? 0}`);
  console.log(`✓ Pending approvals: ${result.pendingApprovals ?? 0}`);
  console.log('\nREADY — Factory Floor operator connectivity is valid.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(`NOT READY — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
