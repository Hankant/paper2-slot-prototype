import {
  chatRequestSchema,
  type ChatRequest,
  type ChatService,
  type ChatStreamEvent,
  type RevealedAdviceBlock,
} from '@contracts';
import { textHash } from '../../domain/text-hash.js';
import { randomId } from '../../uuid.js';
import { STANDARD_QUESTION, FOLLOWUP_QUESTION } from '../../domain/chat-materials.js';

interface Reply {
  request: string;
  messageId: string;
  openedAt: string;
  chunks: string[];
  delivered: number;
  active: boolean;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** In-memory scripted implementation; authorize reads the actual trial/source state. */
export function createScriptedChat(
  authorize: (request: ChatRequest) => Promise<RevealedAdviceBlock>,
  timing = { firstMs: 450, chunkMs: 65 },
): ChatService {
  const replies = new Map<string, Reply>();
  return {
    async describeCapabilities() {
      return {
        provider: 'scripted-memory',
        adapter_version: '0.3.0',
        capabilities: {
          persistentResults: 'unsupported',
          idempotentWrites: 'unsupported',
          resumeSession: 'unsupported',
          serverControlledTrials: 'unsupported',
          serverScoring: 'unsupported',
          individualEntryCodes: 'unsupported',
        },
      };
    },
    async *streamReply(raw, signal): AsyncIterable<ChatStreamEvent> {
      const request = chatRequestSchema.parse(raw) as ChatRequest;
      const advice = await authorize(request);
      const fingerprint = JSON.stringify(request);
      let reply = replies.get(request.request_id);
      if (reply && reply.request !== fingerprint) throw new Error('同一请求的内容发生变化');
      if (reply?.active) throw new Error('同一回答正在生成');
      if (!reply) {
        const answer =
          request.user_text === STANDARD_QUESTION
            ? `我的建议是机器 ${advice.advice_target_machine_id}。\n\n${advice.copy}\n\n你可以保留自己的判断，也可以调整最终预测。`
            : request.user_text === FOLLOWUP_QUESTION
              ? '这条建议是一个可供参考的预测，并不保证本轮中奖。请结合已有信息，根据你的判断确认最终答案。'
              : '当前对话聚焦于本轮预测。你可以点击下方的标准问题，查看本轮建议或了解如何使用建议。';
        const chars = Array.from(answer);
        const chunks: string[] = [];
        for (let i = 0; i < chars.length; i += 2) chunks.push(chars.slice(i, i + 2).join(''));
        reply = {
          request: fingerprint,
          messageId: randomId(),
          openedAt: new Date().toISOString(),
          chunks,
          delivered: 0,
          active: false,
        };
        replies.set(request.request_id, reply);
      }
      reply.active = true;
      const previous = reply.delivered;
      const base = {
        schema_version: request.client_versions.contract_version,
        ...request.client_versions,
        request_id: request.request_id,
        message_meta: {
          message_id: reply.messageId,
          request_id: request.request_id,
          author: 'assistant' as const,
          opened_at: reply.openedAt,
          adapter_version: 'scripted-memory/0.3.0',
        },
        server_timestamp: null,
      };
      let last = -1;
      try {
        yield { ...base, event_id: randomId(), type: 'started', sequence: -1 };
        if (previous === 0) await pause(timing.firstMs, signal);
        for (let i = 0; i < reply.chunks.length; i += 1) {
          if (signal.aborted) {
            yield {
              ...base,
              event_id: randomId(),
              type: 'cancelled',
              sequence: -1,
              last_sequence: last,
            };
            return;
          }
          if (i >= previous) await pause(timing.chunkMs, signal);
          if (signal.aborted) {
            yield {
              ...base,
              event_id: randomId(),
              type: 'cancelled',
              sequence: -1,
              last_sequence: last,
            };
            return;
          }
          last = i;
          reply.delivered = Math.max(reply.delivered, i + 1);
          const text = reply.chunks[i];
          if (text === undefined) throw new Error('缺少脚本片段');
          yield {
            ...base,
            event_id: randomId(),
            type: 'text_delta',
            sequence: i,
            text,
            author: 'assistant',
          };
        }
        yield {
          ...base,
          event_id: randomId(),
          type: 'completed',
          sequence: -1,
          content_hash: await textHash(reply.chunks.join('')),
          total_text_deltas: reply.chunks.length,
          final: true,
        };
      } finally {
        reply.active = false;
      }
    },
  };
}
