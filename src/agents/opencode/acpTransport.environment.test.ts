import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { OpenCodeAcpTransport, type OpenCodeAcpProcess } from './acpTransport.js';

class FakeProcess extends EventEmitter implements OpenCodeAcpProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  kill(): boolean { return true; }
}

describe('OpenCodeAcpTransport environment', () => {
  it('uses an explicit child-process environment without mutating the host environment', async () => {
    const childEnv = { PATH: '/test/bin', OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"deny"}}' };
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const transport = new OpenCodeAcpTransport({
      env: childEnv,
      spawnProcess: (_command, _args, options) => {
        capturedEnv = options.env;
        return new FakeProcess();
      },
    });

    expect(capturedEnv).toEqual(childEnv);
    expect(process.env.OPENCODE_CONFIG_CONTENT).not.toBe(childEnv.OPENCODE_CONFIG_CONTENT);
    await transport.close();
  });
});
