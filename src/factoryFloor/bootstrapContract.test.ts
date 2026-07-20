import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const EXPECTED_FIXTURE_DIGEST = 'ab0fa633bedc1105db08a019489985083bc0e81a274e5260c25067eff8150ca1';

interface BootstrapFixture {
  schemaVersion: number;
  protocol: string;
  oauthStart: {
    request: { instanceId: string; codeChallenge: string };
    response: {
      state: string;
      clientId: string;
      scopes: string[];
      codeChallengeMethod: string;
      expiresAt: number;
    };
  };
  bootstrap: {
    request: {
      state: string;
      instanceId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
    };
    validatedInstance: {
      applicationId: string;
      instanceId: string;
      launchId: string;
      location: {
        id: string;
        kind: string;
        guildId: string;
        channelId: string;
      };
      users: string[];
    };
    factoryFloorRequest: Record<string, unknown>;
    response: Record<string, unknown>;
  };
  errors: string[];
}

const fixtureUrl = new URL(
  '../../contracts/discord-activity/bootstrap-v1.json',
  import.meta.url,
);
const fixtureBytes = readFileSync(fixtureUrl);
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as BootstrapFixture;

describe('Discord Activity bootstrap contract fixture', () => {
  it('matches the cross-repository raw digest and protocol version', () => {
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
      EXPECTED_FIXTURE_DIGEST,
    );
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      protocol: 'discord-agent-activity-bootstrap',
    });
  });

  it('contains a coherent S256 PKCE vector', () => {
    const derived = createHash('sha256')
      .update(fixture.bootstrap.request.codeVerifier)
      .digest('base64url');
    expect(derived).toBe(fixture.oauthStart.request.codeChallenge);
    expect(fixture.oauthStart.response.codeChallengeMethod).toBe('S256');
    expect(fixture.oauthStart.request.instanceId).toBe(
      fixture.bootstrap.request.instanceId,
    );
    expect(fixture.oauthStart.response.state).toBe(
      fixture.bootstrap.request.state,
    );
  });

  it('freezes the server-derived Factory Floor request and bounded response', () => {
    expect(fixture.bootstrap.factoryFloorRequest).toEqual({
      applicationId: 'application-1',
      instanceId: 'i-launch-1-gc-guild-1-thread-1',
      installationId: 'guild-1',
      guildId: 'guild-1',
      channelId: 'agent-1',
      threadId: 'thread-1',
      launchId: 'launch-1',
      principalId: 'user-1',
      adapter: 'discord-agent',
      boundRunId: 'run-1',
    });
    expect(fixture.bootstrap.response).toMatchObject({
      discord: {
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'identify',
      },
      factoryFloor: {
        instanceBindingId: 'binding-1',
      },
      context: {
        kind: 'run',
        projectId: 'ff-project-1',
        runId: 'run-1',
      },
    });
  });
});
