import type { FactoryFloorBridgeService } from '../factoryFloor/bridgeService.js';

let service: FactoryFloorBridgeService | null = null;

export function setFactoryFloorBridgeService(value: FactoryFloorBridgeService): void {
  service = value;
}

export function getFactoryFloorBridgeService(): FactoryFloorBridgeService | undefined {
  return service ?? undefined;
}

export function clearFactoryFloorBridgeService(): void {
  service?.close();
  service = null;
}
