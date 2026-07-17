import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { redactErrorMessage } from '../../utils/redaction.js';
import { buildPrimaryPrompt, parsePrimaryResponse, type PrimaryModel, type PrimaryResponse } from '../../primary/primaryModel.js';

export class ClaudePrimaryModel implements PrimaryModel {
  constructor(private readonly options: { model?: string; queryFn?: typeof sdkQuery } = {}) {}

  async respond(input: { context: string; message: string }): Promise<PrimaryResponse> {
    const queryFn = this.options.queryFn ?? sdkQuery;
    const prompt = buildPrimaryPrompt(input);
    try {
      let text = '';
      for await (const message of queryFn({
        prompt,
        options: {
          allowedTools: [],
          disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Task'],
          settingSources: ['user'],
          maxTurns: 1,
          ...(this.options.model ? { model: this.options.model } : {}),
        },
      })) {
        const value = message as any;
        if (value?.type === 'assistant' && Array.isArray(value.message?.content)) {
          text += value.message.content
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => part.text)
            .join('');
        }
        if (value?.type === 'result' && typeof value.result === 'string') text ||= value.result;
      }
      return parsePrimaryResponse(text);
    } catch (error) {
      return { reply: `I could not complete the coordination turn: ${redactErrorMessage(error)}` };
    }
  }
}
