import { ChatInputCommandInteraction } from 'discord.js';
import { getProjectByChannel } from '../services/projectStore.js';
import { parseDuration, startLoop } from '../services/loopRunner.js';

const DEFAULT_INTERVAL_MS = 10 * 60_000;

export async function handleLoop(interaction: ChatInputCommandInteraction): Promise<void> {
  const project = getProjectByChannel(interaction.channelId);
  if (!project || interaction.channelId !== project.claudeChannelId) {
    await interaction.reply({ content: 'This command can only be used in a project #claude channel.', ephemeral: true });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);
  const intervalStr = interaction.options.getString('interval');

  let intervalMs = DEFAULT_INTERVAL_MS;
  if (intervalStr) {
    const parsed = parseDuration(intervalStr);
    if (parsed === null) {
      await interaction.reply({
        content: 'Invalid interval. Use formats like `5m`, `1h`, `30s`, `2h30m`.',
        ephemeral: true,
      });
      return;
    }
    intervalMs = parsed;
  }

  await interaction.deferReply();

  // We need a Message object for startLoop, so we send via the deferred reply
  // and use followUp for the loop. Use a workaround: fetch the reply message.
  await interaction.editReply(`Starting loop...`);
  const replyMsg = await interaction.fetchReply();

  await startLoop(intervalMs, prompt, project, replyMsg);
}
