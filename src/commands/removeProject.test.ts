import { describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Project } from '../types.js';
import { handleRemoveProject } from './removeProject.js';

const project: Project = {
  name: 'factory-floor',
  workingDirectory: '/repos/factory-floor',
  categoryId: 'category-1',
  agentChannelId: 'agent-1',
  roborevChannelId: 'review-1',
  defaultProvider: 'claude',
};

function interaction() {
  return {
    options: { getString: vi.fn(() => 'factory-floor') },
    guild: { id: 'guild-1' },
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    deferReply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
  };
}

describe('removeProject', () => {
  it('terminalizes active scheduled loops before archiving and deleting Discord channels', async () => {
    const command = interaction();
    const getProject = vi.fn(() => project);
    const terminalizeLoopsByProject = vi.fn(() => [{ id: 'loop-1' }]);
    const removeProject = vi.fn(() => project);
    const deleteProjectChannels = vi.fn(async () => undefined);
    const notifyRoborevConfigurationChanged = vi.fn();

    await handleRemoveProject(command, {
      getProject,
      terminalizeLoopsByProject,
      removeProject,
      deleteProjectChannels,
      notifyRoborevConfigurationChanged,
    });

    expect(getProject).toHaveBeenCalledWith('factory-floor');
    expect(terminalizeLoopsByProject).toHaveBeenCalledWith(
      'factory-floor',
      'Project archived',
    );
    expect(removeProject).toHaveBeenCalledWith('factory-floor');
    expect(deleteProjectChannels).toHaveBeenCalledWith(
      command.guild,
      'category-1',
      'agent-1',
      'review-1',
    );
    expect(terminalizeLoopsByProject.mock.invocationCallOrder[0]).toBeLessThan(
      removeProject.mock.invocationCallOrder[0]!,
    );
    expect(removeProject.mock.invocationCallOrder[0]).toBeLessThan(
      deleteProjectChannels.mock.invocationCallOrder[0]!,
    );
    expect(command.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/archived.*scheduled loop.*stopped/i),
    );
  });

  it('does not terminalize loops when the project does not exist', async () => {
    const command = interaction();
    const getProject = vi.fn(() => undefined);
    const terminalizeLoopsByProject = vi.fn();
    const removeProject = vi.fn(() => undefined);

    await handleRemoveProject(command, {
      getProject,
      terminalizeLoopsByProject,
      removeProject,
      deleteProjectChannels: vi.fn(async () => undefined),
      notifyRoborevConfigurationChanged: vi.fn(),
    });

    expect(terminalizeLoopsByProject).not.toHaveBeenCalled();
    expect(removeProject).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringMatching(/not found/i),
    }));
  });
});
