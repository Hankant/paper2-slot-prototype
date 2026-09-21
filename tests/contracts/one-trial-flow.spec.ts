import { describe, expect, it } from 'vitest';
import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from '../../src/adapters/local-demo/one-trial-preview.js';
import {
  capabilitiesSchema,
  CLIENT_VERSION,
  CONTRACT_VERSION,
  parseEventEnvelope,
  publicTrialSchema,
  saveReceiptSchema,
  satisfiesRequired,
  trialFeedbackSchema,
  type Session,
} from '@contracts';
import { CONSUMER_PROBE } from '../../src/experiment/contracts-consumer.js';

async function setup() {
  const adapter = createOneTrialPreview();
  const session = await adapter.sessionService.openSession({
    entry_code: 'PREVIEW-ONLY',
    observed_device_class: 'unknown',
    observed_participation_mode: 'unknown',
    client_versions: {
      contract_version: CONTRACT_VERSION,
      material_version: '0.3.0',
      client_version: CLIENT_VERSION,
      protocol_version: 'unreleased',
    },
  });
  return { adapter, session };
}
function event(session: Session, sequence: number, type: string, payload: unknown) {
  return parseEventEnvelope({
    schema_version: '0.3.0',
    contract_version: CONTRACT_VERSION,
    client_version: CLIENT_VERSION,
    material_version: '0.3.0',
    protocol_version: 'unreleased',
    session_id: session.session_id,
    participant_id: session.participant_id,
    event_id: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    sequence_no: sequence,
    phase: 'main',
    event_type: type,
    client_timestamp: '2026-09-18T00:00:00.000Z',
    elapsed_ms: 1000,
    ...(type === 'session_completion_requested' ? {} : { trial_id: PREVIEW_TRIAL_ID }),
    payload,
  });
}

describe('one trial through public services (memory-only preview)', () => {
  it('imports both bare and subpath aliases at runtime', () => {
    expect(CONSUMER_PROBE.contractVersion).toBe(CONTRACT_VERSION);
  });
  it.each([
    ['A', 'left', 0],
    ['C', 'right', 10],
  ])('scores actual winner for final %s', async (machine, position, points) => {
    const { adapter, session } = await setup();
    const trial = publicTrialSchema.parse(
      await adapter.trialService.loadTrial(session, PREVIEW_TRIAL_ID),
    );
    expect(trial.advice).toEqual({ advice_id: 'preview-advice-1', revealed: false });
    const caps = capabilitiesSchema.parse(await adapter.sessionService.describeCapabilities());
    expect(satisfiesRequired(caps.capabilities)).toBe(false);
    const send = async (sequence: number, type: string, payload: unknown) => {
      const message = event(session, sequence, type, payload);
      const receipt = saveReceiptSchema.parse(
        await adapter.resultStore.saveEvents(session, [message]),
      );
      expect(receipt.acknowledged_event_ids).toEqual([message.event_id]);
      expect(receipt.persistence_scope).toBe('memory');
      expect(receipt.rejected_events).toEqual([]);
    };
    await send(0, 'prediction_submitted', { machine_id: 'A', display_position: 'left' });
    await send(1, 'confidence_submitted', { confidence_percent: 70 });
    await send(2, 'source_selected', { source: 'ai' });
    const advice = await adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID);
    expect(advice.advice_target_machine_id).toBe('B');
    await send(3, 'advice_revealed', { advice_id: advice.advice_id, revealed_at_phase: 'main' });
    await send(4, 'final_prediction_submitted', {
      machine_id: machine,
      display_position: position,
      changed_after_advice: machine !== 'A',
    });
    const feedback = trialFeedbackSchema.parse(
      await adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID),
    );
    expect(feedback.actual_winner_machine_id).toBe('C');
    expect(feedback.independent_correct).toBe(false);
    expect(feedback.points_awarded).toBe(points);
    expect(await adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID)).toEqual(feedback);
    await send(5, 'feedback_presented', { presented_at_ms: 1200 });
    await send(6, 'session_completion_requested', { ack_required_event_count: 6 });
    expect((await adapter.sessionService.finishSession(session)).session_status).toBe('completed');
    expect((await adapter.sessionService.loadState(session)).completed).toBe(true);
    expect(adapter.exportEvents()).toHaveLength(7);
  });
  it('blocks early advice, feedback and completion', async () => {
    const { adapter, session } = await setup();
    await expect(adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID)).rejects.toMatchObject({
      code: 'OUT_OF_ORDER',
    });
    await expect(adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID)).rejects.toMatchObject(
      { code: 'OUT_OF_ORDER' },
    );
    await expect(adapter.sessionService.finishSession(session)).rejects.toMatchObject({
      code: 'OUT_OF_ORDER',
    });
  });
  it('acks retry once, rejects changed content and preserves independent answer', async () => {
    const { adapter, session } = await setup();
    const message = event(session, 0, 'prediction_submitted', {
      machine_id: 'A',
      display_position: 'left',
    });
    await adapter.resultStore.saveEvents(session, [message]);
    expect(
      (await adapter.resultStore.saveEvents(session, [structuredClone(message)]))
        .acknowledged_event_ids,
    ).toEqual([message.event_id]);
    const conflict = { ...message, payload: { machine_id: 'B', display_position: 'center' } };
    const result = await adapter.resultStore.saveEvents(session, [parseEventEnvelope(conflict)]);
    expect(result.rejected_events[0]?.reason_code).toBe('EVENT_CONFLICT');
    expect(adapter.exportEvents()).toEqual([message]);
  });
  it('returns partial receipts for one valid and one out-of-order event', async () => {
    const { adapter, session } = await setup();
    const good = event(session, 0, 'prediction_submitted', {
      machine_id: 'A',
      display_position: 'left',
    });
    const bad = event(session, 1, 'source_selected', { source: 'ai' });
    const receipt = saveReceiptSchema.parse(
      await adapter.resultStore.saveEvents(session, [good, bad]),
    );
    expect(receipt.acknowledged_event_ids).toEqual([good.event_id]);
    expect(receipt.rejected_events[0]?.event_id).toBe(bad.event_id);
    expect(adapter.exportEvents()).toHaveLength(1);
  });
  it('rejects crossed session identities', async () => {
    const { adapter, session } = await setup();
    const foreign = event({ ...session, participant_id: 'other' }, 0, 'prediction_submitted', {
      machine_id: 'A',
      display_position: 'left',
    });
    expect(
      (await adapter.resultStore.saveEvents(session, [foreign])).rejected_events[0]?.reason_code,
    ).toBe('INVALID_EVENT');
    expect(adapter.exportEvents()).toHaveLength(0);
  });
});
