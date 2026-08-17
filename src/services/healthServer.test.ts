import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer, type HealthServerHandle } from './healthServer.js';

const handles: HealthServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.close()));
});

describe('health server', () => {
  it('reports liveness while readiness remains false until every dependency is ready', async () => {
    const handle = await startHealthServer({ port: 0 });
    handles.push(handle);

    const live = await fetch(`http://${handle.host}:${handle.port}/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ live: true });

    const initialReady = await fetch(`http://${handle.host}:${handle.port}/ready`);
    expect(initialReady.status).toBe(503);

    handle.update({ recoveryReady: true, storageReady: true, discordReady: true });
    const providerMissing = await fetch(`http://${handle.host}:${handle.port}/ready`);
    expect(providerMissing.status).toBe(503);

    handle.update({ providerReady: true });
    const ready = await fetch(`http://${handle.host}:${handle.port}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      live: true,
      ready: true,
      recoveryReady: true,
      storageReady: true,
      discordReady: true,
      providerReady: true,
    });
  });

  it('rejects non-loopback bindings', async () => {
    await expect(startHealthServer({ host: '0.0.0.0', port: 0 })).rejects.toThrow(
      'Health server must bind to a loopback host.',
    );
  });
});
