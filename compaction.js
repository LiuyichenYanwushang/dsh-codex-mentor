import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SUMMARY_INSTRUCTION } from './prompts.js';

// Keep DSH's pressure, persistence, cancellation and replay machinery unchanged.
export default class MentorCompaction extends BasicCompactionEngine {
  summarize(input, agent, signal) {
    return super.summarize({ ...input, messages: [...input.messages, createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: SUMMARY_INSTRUCTION }] })] }, agent, signal);
  }
}
