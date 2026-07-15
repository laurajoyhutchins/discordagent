import type { PrimaryAgentService } from '../primary/primaryAgentService.js';
let service: PrimaryAgentService | null = null;
export function setPrimaryAgentService(value: PrimaryAgentService): void { service = value; }
export function getPrimaryAgentService(): PrimaryAgentService | undefined { return service ?? undefined; }
export function clearPrimaryAgentService(): void { service = null; }
