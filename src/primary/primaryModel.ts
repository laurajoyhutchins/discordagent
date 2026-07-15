import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { redactErrorMessage } from '../utils/redaction.js';

export interface PrimaryTaskProposal { projectName: string; objective: string; provider?: 'claude' | 'codex'; rationale?: string; }
export interface PrimaryMemoryWrite { namespace: string; key: string; value: unknown; sourceQuote: string; confidence?: number; }
export interface PrimaryDecision { kind: 'confirm' | 'select' | 'poll'; prompt: string; options: string[]; }
export interface PrimaryResponse { reply: string; taskProposal?: PrimaryTaskProposal; memoryWrites?: PrimaryMemoryWrite[]; decision?: PrimaryDecision; }
export interface PrimaryModel { respond(input: { context: string; message: string }): Promise<PrimaryResponse>; }

export class ClaudePrimaryModel implements PrimaryModel {
  constructor(private readonly options: { model?: string; queryFn?: typeof sdkQuery } = {}) {}
  async respond(input: { context: string; message: string }): Promise<PrimaryResponse> {
    const queryFn = this.options.queryFn ?? sdkQuery;
    const prompt = `You are the primary project-owner agent in a private Discord workspace. Be concise and outcome-focused. You may discuss, remember direct user preferences only when you include an exact sourceQuote copied from the current user message, propose one bounded coding task, or request a decision. You have no coding tools and must not pretend to execute work. Return only JSON matching: {"reply":string,"taskProposal"?:{"projectName":string,"objective":string,"provider"?:"claude"|"codex","rationale"?:string},"memoryWrites"?:[{"namespace":string,"key":string,"value":unknown,"sourceQuote":string,"confidence"?:number}],"decision"?:{"kind":"confirm"|"select"|"poll","prompt":string,"options":string[]}}.\n\nWORKSPACE CONTEXT\n${input.context}\n\nUSER\n${input.message}`;
    try {
      let text = '';
      for await (const message of queryFn({ prompt, options: { allowedTools: [], disallowedTools: ['Bash','Read','Write','Edit','Grep','Glob','WebSearch','WebFetch','Task'], settingSources: ['user'], maxTurns: 1, ...(this.options.model ? { model: this.options.model } : {}) } })) {
        const value = message as any;
        if (value?.type === 'assistant' && Array.isArray(value.message?.content)) {
          text += value.message.content.filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('');
        }
        if (value?.type === 'result' && typeof value.result === 'string') text ||= value.result;
      }
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { reply: text.trim() || 'I could not form a response.' };
      const parsed = JSON.parse(match[0]) as PrimaryResponse;
      if (!parsed.reply || typeof parsed.reply !== 'string') throw new Error('Primary model response omitted reply');
      return parsed;
    } catch (error) {
      return { reply: `I could not complete the coordination turn: ${redactErrorMessage(error)}` };
    }
  }
}
