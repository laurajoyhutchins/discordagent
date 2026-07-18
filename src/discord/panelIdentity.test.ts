import { describe, expect, it } from 'vitest';
import { createPanelIdentityRegistry, componentSchema, type PanelIdentityKey } from './panelIdentity.js';

const key: PanelIdentityKey = {
  kind: 'settings',
  userId: 'owner-1',
  channelId: 'channel-1',
};

function message(id: string, components: unknown[], author: { bot: boolean } = { bot: true }) {
  return { id, channelId: 'channel-1', author, components };
}

describe('panel identity registry', () => {
  it('accepts only the current bot-authored message with its exact component schema', () => {
    const registry = createPanelIdentityRegistry();
    const components = [{ type: 1, components: [{ type: 2, custom_id: 'settings:g:refresh' }] }];
    registry.register(key, message('panel-1', components), components);

    expect(registry.matches(key, message('panel-1', components))).toBe(true);
    expect(registry.matches(key, message('panel-0', components))).toBe(false);
    expect(registry.matches(key, message('panel-1', [{ type: 1, components: [] }]))).toBe(false);
    expect(registry.matches(key, message('panel-1', components, { bot: false }))).toBe(false);
  });

  it('replaces the current identity and invalidates the previous message', () => {
    const registry = createPanelIdentityRegistry();
    const first = [{ type: 1, components: [{ type: 2, custom_id: 'settings:g:refresh' }] }];
    const second = [{ type: 1, components: [{ type: 3, custom_id: 'settings:g:provider' }] }];
    registry.register(key, message('panel-1', first), first);
    registry.register(key, message('panel-2', second), second);

    expect(registry.matches(key, message('panel-1', first))).toBe(false);
    expect(registry.matches(key, message('panel-2', second))).toBe(true);
  });

  it('serializes builders and resolved Discord components consistently', () => {
    const components = [{ type: 1, components: [{ type: 2, custom_id: 'codex_auth_check', style: 1 }] }];
    expect(componentSchema(components)).toBe(componentSchema(components.map(row => ({ ...row }))));
  });
});
