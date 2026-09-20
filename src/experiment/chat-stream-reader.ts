import { chatStreamEventSchema, type ChatStreamEvent } from '@contracts';

import { textHash } from '../domain/text-hash.js';

/** Stateful validation of a single transport attempt, used by the real UI. */
export async function* readChatStream(
  stream: AsyncIterable<unknown>,
  requestId: string,
): AsyncIterable<ChatStreamEvent> {
  let started = false;
  let terminal = false;
  let messageId = '';
  let text = '';
  let count = 0;
  const ids = new Set<string>();
  for await (const raw of stream) {
    const event = chatStreamEventSchema.parse(raw) as ChatStreamEvent;
    if (terminal) throw new Error('流结束后仍有事件');
    if (ids.has(event.event_id)) throw new Error('重复流事件');
    ids.add(event.event_id);
    if (event.request_id !== requestId || event.message_meta.request_id !== requestId)
      throw new Error('回答混入其他请求');
    if (!started) {
      if (event.type !== 'started') throw new Error('缺少回答开始事件');
      started = true;
      messageId = event.message_meta.message_id;
    } else {
      if (event.type === 'started') throw new Error('重复开始回答');
      if (event.message_meta.message_id !== messageId) throw new Error('回答标识变化');
      if (event.type === 'text_delta') {
        if (event.sequence !== count) throw new Error('回答片段缺失或乱序');
        count += 1;
        text += event.text;
      } else {
        terminal = true;
        if (
          event.type === 'completed' &&
          (event.total_text_deltas !== count || event.content_hash !== (await textHash(text)))
        )
          throw new Error('回答内容校验失败');
        if (event.type === 'cancelled' && event.last_sequence !== count - 1)
          throw new Error('停止位置与收到的内容不一致');
      }
    }
    yield event;
  }
  if (!started || !terminal) throw new Error('回答传输中断，尚未完整结束');
}
