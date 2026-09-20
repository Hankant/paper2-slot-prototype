import {
  CONTRACT_VERSION,
  CLIENT_VERSION,
  parseEventEnvelope,
  publicTrialSchema,
  saveReceiptSchema,
  trialFeedbackSchema,
  type EntryCredential,
  type ExperimentAdapter,
  type Session,
  type PublicTrial,
  type RevealedAdviceBlock,
  type SaveReceipt,
  type TrialFeedback,
  type ChatRequest,
  type EventEnvelope,
} from '@contracts';

export type RunStage =
  'prediction' | 'source' | 'chat' | 'final' | 'ready' | 'spinning' | 'feedback';

export interface AuditRecord {
  readonly id: string;
  readonly type: string;
  readonly at_ms: number;
  readonly data: unknown;
}

/** Server-confirmed state used to resume an interrupted session. */
export interface RestoredSnapshot {
  readonly session: Session;
  readonly events: ReadonlyArray<EventEnvelope>;
  readonly completed?: boolean;
}

export interface RunHooks {
  /** Entry credential for remote sessions; preview default when omitted. */
  readonly credential?: EntryCredential;
  /** Confirmed server events from a previous page load of the same session. */
  readonly snapshot?: RestoredSnapshot;
  /** Flush pending audit (queued durably by the caller) before /api/finish. */
  readonly flushAudit?: (records: ReadonlyArray<AuditRecord>) => Promise<void>;
  /** Observe every durable save receipt (remote save status UI). */
  readonly onReceipt?: (receipt: SaveReceipt) => void;
  /** Persist locally as soon as the record is created, before network work. */
  readonly onAudit?: (record: AuditRecord) => void;
}

const PREVIEW_CREDENTIAL: EntryCredential = {
  entry_code: 'PREVIEW-ONLY',
  observed_device_class: 'unknown',
  observed_participation_mode: 'unknown',
  client_versions: {
    contract_version: CONTRACT_VERSION,
    client_version: CLIENT_VERSION,
    material_version: '0.3.0',
    protocol_version: 'unreleased',
  },
};

export class ImmersiveRun {
  stage: RunStage = 'prediction';
  session!: Session;
  trial!: PublicTrial;
  independent = '';
  final = '';
  confidence: number | null = null;
  source: 'human' | 'ai' | null = null;
  advice: RevealedAdviceBlock | null = null;
  feedback: TrialFeedback | null = null;
  sequence = 0;
  chatCompleted = false;
  restored = false;
  completed = false;
  readonly audit: AuditRecord[] = [];
  private readonly records = new Map<string, { event: EventEnvelope; confirmed: boolean }>();
  private clock = performance.now();
  constructor(
    readonly adapter: ExperimentAdapter,
    readonly trialId: string,
    private readonly hooks: RunHooks = {},
  ) {}

  async initialize(consent?: { version: string; acceptedAt: string }): Promise<void> {
    this.session = await this.adapter.sessionService.openSession(
      this.hooks.credential ?? PREVIEW_CREDENTIAL,
    );
    if (this.hooks.snapshot) this.restoreSnapshot(this.hooks.snapshot);
    if (consent)
      await this.save('consent_recorded', { version: consent.version }, consent.acceptedAt);
    this.trial = publicTrialSchema.parse(
      await this.adapter.trialService.loadTrial(this.session, this.trialId),
    ) as PublicTrial;
    this.clock = performance.now();
    // After a reload the advice may already be revealed server-side; refetch
    // the revealed block so the final-stage copy stays accurate.
    if (this.restored && this.source === 'ai' && !this.advice) {
      this.advice = await this.adapter.trialService.loadAdvice(this.session, this.trialId);
    }
    this.note('opened', { ui_version: 'atelier-2', self_advice: false, restored: this.restored });
  }

  /** Restore server-confirmed events: locked answers, sequence and stage. */
  private restoreSnapshot(snapshot: RestoredSnapshot): void {
    if (snapshot.session.session_id !== this.session.session_id) return;
    const confirmed = snapshot.events
      .map((e) => parseEventEnvelope(e))
      .filter((e) => e.session_id === this.session.session_id)
      .sort((a, b) => a.sequence_no - b.sequence_no);
    for (const event of confirmed) {
      this.records.set(event.event_type, { event, confirmed: true });
      this.sequence = Math.max(this.sequence, event.sequence_no + 1);
    }
    if (confirmed.length === 0) return;
    this.restored = true;
    this.completed = snapshot.completed === true;

    const prediction = this.records.get('prediction_submitted')?.event;
    if (prediction?.event_type === 'prediction_submitted')
      this.independent = prediction.payload.machine_id;
    const confidence = this.records.get('confidence_submitted')?.event;
    if (confidence?.event_type === 'confidence_submitted')
      this.confidence = confidence.payload.confidence_percent;
    const source = this.records.get('source_selected')?.event;
    if (
      source?.event_type === 'source_selected' &&
      (source.payload.source === 'human' || source.payload.source === 'ai')
    )
      this.source = source.payload.source;
    const final = this.records.get('final_prediction_submitted')?.event;
    if (final?.event_type === 'final_prediction_submitted') this.final = final.payload.machine_id;

    const hasConfidence = this.records.has('confidence_submitted');
    const adviceRevealed = this.records.has('advice_revealed');
    const feedbackPresented = this.records.has('feedback_presented');

    if (!prediction || !hasConfidence) {
      // Partial prediction retries the SAME original choice (save() is
      // idempotent per event_id); stage stays open for the missing half.
      this.stage = 'prediction';
    } else if (!this.source) {
      this.stage = 'source';
    } else if (this.source === 'ai' && !adviceRevealed) {
      this.stage = 'chat';
      this.chatCompleted = false;
    } else if (!final) {
      this.chatCompleted = this.source === 'ai';
      this.stage = 'final';
    } else if (!feedbackPresented) {
      this.stage = 'ready';
    } else {
      this.chatCompleted = this.source === 'ai';
      this.stage = 'feedback';
    }
  }

  /** Re-adopt previously delivered audit records (e.g. after a reload). */
  restoreAudit(records: ReadonlyArray<unknown>): number {
    const known = new Set(this.audit.map((r) => r.id));
    let added = 0;
    for (const raw of records) {
      if (typeof raw !== 'object' || raw === null) continue;
      const candidate = raw as Partial<AuditRecord>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.type !== 'string' ||
        typeof candidate.at_ms !== 'number' ||
        known.has(candidate.id)
      )
        continue;
      known.add(candidate.id);
      this.audit.push({
        id: candidate.id,
        type: candidate.type,
        at_ms: candidate.at_ms,
        data: candidate.data ?? null,
      });
      added += 1;
    }
    return added;
  }

  note(type: string, data: unknown = null): void {
    const record = {
      // New presentation gets a new ID; retries reuse the queued record.
      id: crypto.randomUUID(),
      type,
      at_ms: Math.round(performance.now()),
      data,
    };
    this.hooks.onAudit?.(record);
    this.audit.push(record);
  }
  private move(stage: RunStage): void {
    this.stage = stage;
    this.clock = performance.now();
  }
  private selection(id: string): {
    machine_id: string;
    display_position: 'left' | 'center' | 'right';
  } {
    const machine = this.trial.machines.find((m) => m.machine_id === id);
    if (!machine) throw new Error('请选择一台机器');
    return { machine_id: id, display_position: machine.display_position };
  }
  private async save(type: string, payload: unknown, timestamp?: string): Promise<void> {
    let record = this.records.get(type);
    if (record?.confirmed) return;
    if (!record) {
      record = {
        confirmed: false,
        event: parseEventEnvelope({
          schema_version: '0.3.0',
          contract_version: CONTRACT_VERSION,
          client_version: CLIENT_VERSION,
          material_version: this.session.material_version,
          protocol_version: this.session.protocol_version,
          session_id: this.session.session_id,
          participant_id: this.session.participant_id,
          event_id: crypto.randomUUID(),
          sequence_no: this.sequence,
          phase: type === 'consent_recorded' ? 'consent' : 'main',
          event_type: type,
          client_timestamp: timestamp ?? new Date().toISOString(),
          elapsed_ms: Math.round(performance.now() - this.clock),
          ...(['session_completion_requested', 'consent_recorded'].includes(type)
            ? {}
            : { trial_id: this.trialId }),
          payload,
        }),
      };
      this.records.set(type, record);
    }
    const receipt = saveReceiptSchema.parse(
      await this.adapter.resultStore.saveEvents(this.session, [record.event]),
    );
    if (!receipt.acknowledged_event_ids.includes(record.event.event_id))
      throw new Error(receipt.rejected_events[0]?.reason_message ?? '记录尚未确认，请重试');
    record.confirmed = true;
    this.sequence += 1;
    this.hooks.onReceipt?.(receipt);
  }
  async predict(id: string, confidence: number): Promise<void> {
    if (this.stage !== 'prediction') throw new Error('独立预测已经锁定');
    this.independent ||= id;
    const locked = this.confidence ?? confidence;
    this.confidence = locked;
    await this.save('prediction_submitted', this.selection(this.independent));
    await this.save('confidence_submitted', { confidence_percent: locked });
    this.move('source');
  }
  async chooseSource(source: 'human' | 'ai'): Promise<void> {
    if (this.stage !== 'source') throw new Error('请先确认独立预测');
    this.source ??= source;
    await this.save('source_selected', { source: this.source });
    if (this.source === 'ai') {
      this.advice = await this.adapter.trialService.loadAdvice(this.session, this.trialId);
      this.move('chat');
    } else this.move('final');
  }
  async authorizeChat(request: ChatRequest): Promise<RevealedAdviceBlock> {
    if (
      this.source !== 'ai' ||
      this.stage !== 'chat' ||
      !this.advice ||
      request.session_id !== this.session.session_id ||
      request.trial_id !== this.trialId ||
      request.advice_id !== this.advice.advice_id ||
      request.source_choice !== 'ai'
    )
      throw new Error('本阶段不可请求 AI 建议');
    if (
      request.client_versions.contract_version !== CONTRACT_VERSION ||
      request.client_versions.client_version !== CLIENT_VERSION ||
      request.client_versions.material_version !== this.session.material_version ||
      request.client_versions.protocol_version !== this.session.protocol_version
    )
      throw new Error('聊天版本不一致');
    return this.adapter.trialService.loadAdvice(this.session, this.trialId);
  }
  async markAdvicePresented(): Promise<void> {
    if (this.stage !== 'chat' || !this.advice) throw new Error('建议不可见');
    await this.save('advice_revealed', {
      advice_id: this.advice.advice_id,
      revealed_at_phase: 'main',
    });
  }
  finishChat(): void {
    if (this.stage !== 'chat' || !this.chatCompleted) throw new Error('请先读完本轮建议');
    this.move('final');
  }
  async confirmFinal(id: string): Promise<void> {
    if (this.stage !== 'final') throw new Error('请先完成前面的步骤');
    this.final ||= id;
    await this.save('final_prediction_submitted', {
      ...this.selection(this.final),
      changed_after_advice: this.final !== this.independent,
    });
    this.move('ready');
  }
  async startDraw(): Promise<TrialFeedback> {
    if (this.stage !== 'ready') throw new Error('请先确认最终预测');
    const result = trialFeedbackSchema.parse(
      await this.adapter.trialService.getFeedback(this.session, this.trialId),
    ) as TrialFeedback;
    this.move('spinning');
    this.note('spin_started');
    return result;
  }
  /** Refetch feedback for an already-persisted final prediction (reload resume). */
  async resumeFeedback(): Promise<TrialFeedback> {
    if (this.stage !== 'ready' && this.stage !== 'feedback' && this.stage !== 'spinning')
      throw new Error('尚未确认最终预测');
    this.feedback ??= trialFeedbackSchema.parse(
      await this.adapter.trialService.getFeedback(this.session, this.trialId),
    ) as TrialFeedback;
    return this.feedback;
  }
  async presentFeedback(result: TrialFeedback): Promise<void> {
    if (this.stage !== 'spinning' && this.stage !== 'feedback') throw new Error('尚未开奖');
    this.feedback ??= result;
    this.move('feedback');
    await this.save('feedback_presented', { presented_at_ms: Math.round(performance.now()) });
    await this.save('session_completion_requested', { ack_required_event_count: this.sequence });
    // Mandatory records are durable; pending audit must be flushed BEFORE finish.
    if (this.hooks.flushAudit) await this.hooks.flushAudit([...this.audit]);
    const receipt = saveReceiptSchema.parse(
      await this.adapter.sessionService.finishSession(this.session),
    );
    // Receipt gating: a non-completed session never reaches the UI as complete.
    if (receipt.session_status !== 'completed') throw new Error('本轮尚未确认完成');
    this.completed = true;
    this.hooks.onReceipt?.(receipt);
  }
}
