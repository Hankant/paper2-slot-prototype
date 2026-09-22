// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from '../../src/adapters/local-demo/one-trial-preview.js';
import { createScriptedChat } from '../../src/adapters/local-chat/scripted-chat.js';
import { STANDARD_QUESTION } from '../../src/domain/chat-materials.js';
import { evaluateAdvice } from '../../src/domain/advice-evaluation.js';
import { ImmersiveRun } from '../../src/experiment/immersive-run.js';
import { readChatStream } from '../../src/experiment/chat-stream-reader.js';
import {
  CLIENT_VERSION,
  CONTRACT_VERSION,
  type ChatRequest,
  type ChatStreamEvent,
} from '@contracts';

async function setup() {
  const adapter = createOneTrialPreview({ adviceForSelf: false });
  const run = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
  await run.initialize();
  const chat = createScriptedChat((r) => run.authorizeChat(r), { firstMs: 0, chunkMs: 0 });
  return { adapter, run, chat };
}
function request(run: ImmersiveRun): ChatRequest {
  return {
    session_id: run.session.session_id,
    trial_id: run.trialId,
    advice_id: run.advice?.advice_id ?? 'not-yet-revealed',
    request_id: crypto.randomUUID(),
    user_text: STANDARD_QUESTION,
    user_text_chars: STANDARD_QUESTION.length,
    source_choice: 'ai',
    locale: 'zh-CN',
    client_versions: {
      contract_version: CONTRACT_VERSION,
      client_version: CLIENT_VERSION,
      material_version: '0.3.0',
      protocol_version: 'unreleased',
    },
  };
}
async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const result: ChatStreamEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}
async function* rawStream(events: unknown[]) {
  for (const event of events) yield event;
}

describe('usable runtime services for the immersive preview', () => {
  it('requires, records and validates the backend-assigned practice condition', async () => {
    const performanceReference = {
      condition_id: 'human-55_ai-plus5',
      human_average_hit_rate: 0.55,
      ai_hit_rate: 0.6,
      ai_accuracy_tier: 'plus_5pp',
      points_per_correct: 20,
      reward_per_point_cny: 0.01,
    } as const;
    const adapter = createOneTrialPreview({
      adviceForSelf: false,
      requirePractice: true,
      performanceReference,
    });
    const run = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
    await run.initialize();
    await run.submitPractice({
      practice_version: 'slot-practice-0.1.0',
      ...performanceReference,
      trials: [
        {
          practice_trial_id: 'practice-01',
          predicted_machine_id: 'A',
          actual_winner_machine_id: 'A',
          correct: true,
          points_awarded: 20,
          response_ms: 500,
        },
      ],
      total_points: 20,
    });
    expect(run.hasPractice()).toBe(true);
    expect(run.practicePoints).toBe(20);
    await run.predict('A', 50);
  });

  it('persists distinct pre/post questionnaire blocks before session completion', async () => {
    const adapter = createOneTrialPreview({ adviceForSelf: false });
    const run = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID, {
      beforeCompletion: async () => {
        await run.submitQuestionnaireBlock({
          block_id: 'post-trust',
          instrument_version: 'demo-questionnaire-0.1.0',
          wording_profile: 'SELF_AI',
          position: 'post',
          item_order: ['POST_PT_AI_RELIABLE'],
          responses: [
            {
              item_id: 'POST_PT_AI_RELIABLE',
              value: 5,
              skipped: false,
              response_ms: 500,
            },
          ],
        });
      },
    });
    await run.initialize();
    await run.submitQuestionnaireBlock({
      block_id: 'pre-prior-beliefs',
      instrument_version: 'demo-questionnaire-0.1.0',
      wording_profile: 'SELF_AI',
      position: 'pre',
      item_order: ['PRE_PRIOR_ACC_SELF'],
      responses: [
        {
          item_id: 'PRE_PRIOR_ACC_SELF',
          value: 60,
          skipped: false,
          response_ms: 400,
        },
      ],
    });
    expect(run.hasQuestionnaireBlock('pre-prior-beliefs')).toBe(true);
    expect(run.hasQuestionnaireBlock('post-trust')).toBe(false);
    await run.predict('A', 60);
    await run.chooseSource('human');
    await run.confirmFinal('C');
    const feedback = await run.startDraw();
    await run.presentFeedback(feedback);

    const events = adapter.exportEvents();
    const questionnaireEvents = events.filter(
      (event) => event.event_type === 'questionnaire_block_submitted',
    );
    expect(questionnaireEvents.map((event) => event.payload.block_id)).toEqual([
      'pre-prior-beliefs',
      'post-trust',
    ]);
    expect(questionnaireEvents.every((event) => event.trial_id === undefined)).toBe(true);
    expect(events.at(-1)?.event_type).toBe('session_completion_requested');
    expect(run.completed).toBe(true);
  });

  it('consent-enabled adapter blocks missing and mismatched consent before loading a trial', async () => {
    const adapter = createOneTrialPreview({ requireConsentVersion: 'preview-consent-test-v1' });
    const missing = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
    await expect(missing.initialize()).rejects.toThrow('请先确认参与说明');
    expect((await adapter.sessionService.loadState(missing.session)).phase).toBe('consent');
    await expect(
      adapter.trialService.loadAdvice(missing.session, PREVIEW_TRIAL_ID),
    ).rejects.toThrow();
    const wrong = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
    await expect(
      wrong.initialize({ version: 'wrong', acceptedAt: new Date().toISOString() }),
    ).rejects.toThrow('参与说明版本不匹配');
    expect(adapter.exportEvents()).toHaveLength(0);
  });
  it('saves versioned consent once before predictions and includes it in completion', async () => {
    const version = 'preview-consent-test-v1';
    const adapter = createOneTrialPreview({ adviceForSelf: false, requireConsentVersion: version });
    const run = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
    const acceptedAt = new Date().toISOString();
    await run.initialize({ version, acceptedAt });
    const consent = adapter.exportEvents()[0];
    if (!consent) throw new Error('missing consent');
    expect(consent).toMatchObject({
      event_type: 'consent_recorded',
      phase: 'consent',
      payload: { version },
      client_timestamp: acceptedAt,
      sequence_no: 0,
    });
    expect(consent).not.toHaveProperty('trial_id');
    const retry = await adapter.resultStore.saveEvents(run.session, [consent]);
    expect(retry.acknowledged_event_ids).toEqual([consent.event_id]);
    expect(retry.current_phase).toBe('main');
    await run.predict('A', 50);
    await run.chooseSource('human');
    await run.confirmFinal('C');
    const result = await run.startDraw();
    expect(result.required_event_types).toContain('consent_recorded');
    await run.presentFeedback(result);
    expect(adapter.exportEvents()).toHaveLength(7);
    expect((await adapter.sessionService.loadState(run.session)).completed).toBe(true);
  });
  it('blocks skips, early AI access and changes to locked choices', async () => {
    const { run, chat } = await setup();
    await expect(run.confirmFinal('B')).rejects.toThrow();
    await expect(run.startDraw()).rejects.toThrow();
    await expect(
      collect(chat.streamReply(request(run), new AbortController().signal)),
    ).rejects.toThrow();
    await run.predict('A', 70);
    await expect(run.predict('B', 20)).rejects.toThrow();
    await run.chooseSource('ai');
    await expect(run.chooseSource('human')).rejects.toThrow();
    expect(() => run.finishChat()).toThrow();
  });
  it('self branch has no exposed advice or AI behavioral comparisons', async () => {
    const { adapter, run, chat } = await setup();
    await run.predict('A', 60);
    await run.chooseSource('human');
    await expect(
      collect(chat.streamReply(request(run), new AbortController().signal)),
    ).rejects.toThrow();
    await expect(adapter.trialService.loadAdvice(run.session, run.trialId)).rejects.toThrow();
    await run.confirmFinal('B');
    const result = await run.startDraw();
    expect(result.advice_actual_hit).toBeNull();
    expect(result.advice_evaluation).toMatchObject({
      advice_exposed: false,
      final_matches_advice: null,
      switched_to_advice: null,
    });
    await run.presentFeedback(result);
    expect(adapter.exportEvents().map((e) => e.event_type)).not.toContain('advice_revealed');
    expect((await adapter.sessionService.loadState(run.session)).completed).toBe(true);
  });
  it.each([
    ['A', 'B', true, true, 0],
    ['A', 'A', false, false, 0],
    ['B', 'B', true, false, 0],
    ['A', 'C', false, false, 10],
  ] as const)(
    'AI comparisons: independent %s, final %s',
    async (initial, final, matches, switched, points) => {
      const { adapter, run, chat } = await setup();
      await run.predict(initial, 70);
      await run.chooseSource('ai');
      const req = request(run);
      const stream = await collect(
        readChatStream(chat.streamReply(req, new AbortController().signal), req.request_id),
      );
      expect(stream.at(-1)?.type).toBe('completed');
      await run.markAdvicePresented();
      run.chatCompleted = true;
      run.finishChat();
      await run.confirmFinal(final);
      const result = await run.startDraw();
      expect(result.actual_winner_machine_id).toBe('C');
      expect(result.advice_actual_hit).toBe(false); // B is wrong, independent of whether followed.
      expect(result.advice_evaluation).toMatchObject({
        advice_exposed: true,
        final_matches_advice: matches,
        switched_to_advice: switched,
      });
      expect(result.points_awarded).toBe(points);
      await run.presentFeedback(result);
      expect(adapter.exportEvents()).toHaveLength(7);
    },
  );
  it('advice correctness changes with outcome; agreement is a separate comparison', () => {
    expect(
      evaluateAdvice({ exposed: true, target: 'B', winner: 'B', independent: 'A', final: 'A' }),
    ).toMatchObject({ advice_correct: true, final_matches_advice: false });
    expect(
      evaluateAdvice({ exposed: true, target: 'B', winner: 'C', independent: 'A', final: 'B' }),
    ).toMatchObject({ advice_correct: false, final_matches_advice: true });
  });
  it('cancel/resume reuses the same message and exact prefix; altered retry is rejected', async () => {
    const { run, chat } = await setup();
    await run.predict('A', 50);
    await run.chooseSource('ai');
    const req = request(run);
    const abort = new AbortController();
    const first: ChatStreamEvent[] = [];
    for await (const event of readChatStream(chat.streamReply(req, abort.signal), req.request_id)) {
      first.push(event);
      if (event.type === 'text_delta' && event.sequence === 2) abort.abort();
    }
    expect(first.at(-1)).toMatchObject({ type: 'cancelled', last_sequence: 2 });
    const resumed = await collect(
      readChatStream(chat.streamReply(req, new AbortController().signal), req.request_id),
    );
    expect(resumed[0]?.message_meta.message_id).toBe(first[0]?.message_meta.message_id);
    const prefix = first
      .filter((e) => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(
      resumed
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join('')
        .startsWith(prefix),
    ).toBe(true);
    await expect(
      collect(
        chat.streamReply(
          { ...req, user_text: 'changed', user_text_chars: 7 },
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow('内容发生变化');
  });
  it('runtime reader rejects invalid terminal order, missing chunks, hash/count and nested identity', async () => {
    const { run, chat } = await setup();
    await run.predict('A', 50);
    await run.chooseSource('ai');
    const req = request(run);
    const events = await collect(chat.streamReply(req, new AbortController().signal));
    const first = events[0];
    const last = events.at(-1);
    const variants: unknown[][] = [
      [...events, { ...first, event_id: crypto.randomUUID() }],
      events.slice(1),
      events.slice(0, -1),
      [first, ...events.slice(2)],
      [...events.slice(0, -1), { ...last, content_hash: '0'.repeat(64) }],
      [...events.slice(0, -1), { ...last, total_text_deltas: 999 }],
      [
        { ...first, message_meta: { ...first?.message_meta, request_id: crypto.randomUUID() } },
        ...events.slice(1),
      ],
      [first, events[1], { ...last, type: 'cancelled', sequence: -1, last_sequence: 8 }],
    ];
    for (const invalid of variants)
      await expect(collect(readChatStream(rawStream(invalid), req.request_id))).rejects.toThrow();
  });
});
