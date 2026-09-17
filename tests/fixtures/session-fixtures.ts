/**
 * Fixed session/trial fixtures for contract acceptance tests.
 *
 * These values are intentionally hand-written, not generated, so reviewers
 * can audit them line-by-line. They are NOT real participant data.
 *
 * G0 covers the four classes required by docs/ACCEPTANCE.md §G0:
 *  - success:        every field shape-valid
 *  - rejection:      one or more fields invalid (caught by runtime validators)
 *  - partial:        save receipt acknowledging some events and rejecting others
 *  - unconfirmed:    network drop / scope=memory / scope=browser_local
 *
 * After the Q G0 review (R1-R6), fixtures that included `advice_timing`
 * also include a valid `advice` block, and capability fixtures declare
 * every `REQUIRED_CAPABILITIES` key explicitly so the hard-floor check
 * is meaningful.
 */

import type {
  Capabilities,
  CapabilitiesInput,
  EntryCredential,
  EntryCredentialInput,
  ExperimentState,
  ExperimentStateInput,
  PublicAdviceBlock,
  PublicTrial,
  PublicTrialInput,
  SaveReceipt,
  SaveReceiptInput,
  Session,
  SessionInput,
} from '../../src/contracts/index.js';

const FIXTURE_UUID_A = '11111111-1111-4111-8111-111111111111';
const FIXTURE_UUID_B = '22222222-2222-4222-8222-222222222222';
const FIXTURE_UUID_C = '33333333-3333-4333-8333-333333333333';
const FIXTURE_UUID_D = '44444444-4444-4444-8444-444444444444';
const FIXTURE_UUID_E = '55555555-5555-4555-8555-555555555555';

export const FIXTURE_EVENT_IDS = {
  accepted: FIXTURE_UUID_A,
  rejected: FIXTURE_UUID_B,
  unconfirmed: FIXTURE_UUID_C,
  adviceRevealed: FIXTURE_UUID_D,
  completionRequested: FIXTURE_UUID_E,
} as const;

export const FIXTURE_TIMESTAMPS = {
  baseline: '2026-09-17T14:00:00.000Z',
  later: '2026-09-17T14:01:30.000Z',
} as const;

export const SUCCESS_SESSION: Session = {
  session_id: 'sess-fixture-success',
  participant_id: 'part-fixture-success',
  recruitment_batch: 'batch-2026-09-17',
  group_assignment: 'A1',
  study_id: 'paper2-slot-prototype',
  protocol_version: 'unreleased',
  material_version: '0.3.0',
  contract_version: '0.3.0',
  adapter_version: '0.3.0',
  provider: 'local-demo',
  metadata: {
    participation_mode: 'on_site',
    device_class: 'desktop',
    recruitment_batch: 'batch-2026-09-17',
    adapter_version: '0.3.0',
    provider: 'local-demo',
  },
};

export const SUCCESS_ENTRY_CREDENTIAL: EntryCredential = {
  entry_code: 'fixture-entry-code-001',
  observed_participation_mode: 'on_site',
  observed_device_class: 'desktop',
  client_versions: {
    protocol_version: 'unreleased',
    contract_version: '0.3.0',
    material_version: '0.3.0',
    client_version: '0.3.0',
  },
};

export const SUCCESS_ADVICE: PublicAdviceBlock = {
  advice_id: 'advice-001',
  advice_target_machine_id: 'B',
  advice_target_display_position: 'center',
  copy: '模拟建议：选择机器 B。',
  revealed: true,
};

export const SUCCESS_PUBLIC_TRIAL: PublicTrial = {
  trial_id: 'trial-001',
  trial_index: 0,
  phase: 'calibration',
  visible_history: [
    { trial_id: 'trial-000', machine_id: 'A', observed_hit_rate: 0.34 },
    { trial_id: 'trial-000', machine_id: 'B', observed_hit_rate: 0.5 },
    { trial_id: 'trial-000', machine_id: 'C', observed_hit_rate: 0.18 },
  ],
  machines: [
    { machine_id: 'A', display_position: 'left', label: '机器 A' },
    { machine_id: 'B', display_position: 'center', label: '机器 B' },
    { machine_id: 'C', display_position: 'right', label: '机器 C' },
  ],
  advice_timing: 'after_choice',
  advice: SUCCESS_ADVICE,
  material_version: '0.3.0',
};

export const SUCCESS_EXPERIMENT_STATE: ExperimentState = {
  session_id: SUCCESS_SESSION.session_id,
  phase: 'calibration',
  trial_index: 0,
  last_confirmed_event_id: null,
  last_confirmed_sequence_no: 0,
  completed: false,
  reconciliation_required: false,
};

export const SUCCESS_SAVE_RECEIPT: SaveReceipt = {
  acknowledged_event_ids: [FIXTURE_UUID_A],
  rejected_events: [],
  unconfirmed_event_ids: [],
  persistence_scope: 'remote',
  session_status: 'in_progress',
  persisted_at: FIXTURE_TIMESTAMPS.baseline,
  receipt_id: 'rcpt-001',
  current_phase: 'calibration',
};

export const PARTIAL_SAVE_RECEIPT: SaveReceipt = {
  acknowledged_event_ids: [FIXTURE_UUID_A],
  rejected_events: [
    {
      event_id: FIXTURE_UUID_B,
      reason_code: 'OUT_OF_ORDER',
      reason_message: 'sequence_no must be monotonic',
    },
  ],
  unconfirmed_event_ids: [],
  persistence_scope: 'remote',
  session_status: 'in_progress',
  persisted_at: FIXTURE_TIMESTAMPS.baseline,
  receipt_id: 'rcpt-002',
  current_phase: 'calibration',
};

export const UNCONFIRMED_SAVE_RECEIPT: SaveReceipt = {
  acknowledged_event_ids: [],
  rejected_events: [],
  unconfirmed_event_ids: [FIXTURE_UUID_A, FIXTURE_UUID_C],
  persistence_scope: 'memory',
  session_status: 'opening',
  persisted_at: null,
  receipt_id: null,
  current_phase: 'entry',
};

/**
 * Capabilities that satisfy `REQUIRED_CAPABILITIES` (post-R4). This is the
 * shape an adapter that passes the G0 production hard-floor must hold.
 */
export const PRODUCTION_CAPABILITIES: Capabilities = {
  provider: 'prod-adapter',
  adapter_version: '0.3.0',
  capabilities: {
    persistentResults: 'supported',
    idempotentWrites: 'supported',
    resumeSession: 'supported',
    serverControlledTrials: 'supported',
    serverScoring: 'unsupported',
    individualEntryCodes: 'unverified',
  },
};

/**
 * Schema-valid capability descriptor that does NOT satisfy the hard-floor
 * because `persistentResults` is unverified. Carries no production
 * guarantee — used to test the validator's reject path.
 */
export const VALID_CAPABILITIES: Capabilities = {
  provider: 'local-demo',
  adapter_version: '0.3.0',
  capabilities: {
    persistentResults: 'unverified',
    idempotentWrites: 'supported',
    resumeSession: 'unsupported',
    serverControlledTrials: 'supported',
    serverScoring: 'unsupported',
    individualEntryCodes: 'unverified',
  },
};

/**
 * Required-key capabilities are `unverified` — this fixture fails the
 * production hard-floor (`satisfiesRequired`).
 */
export const INSUFFICIENT_CAPABILITIES: Capabilities = {
  provider: 'local-demo',
  adapter_version: '0.3.0',
  capabilities: {
    persistentResults: 'unverified',
    idempotentWrites: 'unverified',
    resumeSession: 'unsupported',
    serverControlledTrials: 'unverified',
    serverScoring: 'unsupported',
    individualEntryCodes: 'unverified',
  },
};

/**
 * Mirrors `config/demo.json` truthfully: LocalDemo has been observed to
 * serve trials but never to have its idempotency / persistence verified.
 * Required keys are `unverified` → this fixture MUST fail the hard-floor.
 */
export const REAL_DEMO_CAPABILITIES: Capabilities = {
  provider: 'local-demo',
  adapter_version: '0.3.0',
  capabilities: {
    persistentResults: 'unverified',
    idempotentWrites: 'unverified',
    resumeSession: 'unsupported',
    serverControlledTrials: 'unverified',
    serverScoring: 'unsupported',
    individualEntryCodes: 'unverified',
  },
};

/**
 * Deliberately invalid: entry_code is shorter than the documented minimum
 * (8 chars). Other fields are within the documented enums.
 */
export const REJECTED_ENTRY_CREDENTIAL: EntryCredentialInput = {
  entry_code: 'short',
  observed_participation_mode: 'on_site',
  observed_device_class: 'desktop',
  client_versions: {
    protocol_version: 'unreleased',
    contract_version: '0.3.0',
    material_version: '0.3.0',
    client_version: '0.3.0',
  },
};

/** Deliberately invalid: probability out of [0, 1]. */
export const REJECTED_PUBLIC_TRIAL: PublicTrialInput = {
  trial_id: 'trial-bad',
  trial_index: 0,
  phase: 'calibration',
  visible_history: [{ trial_id: 'trial-000', machine_id: 'A', observed_hit_rate: 1.5 }],
  machines: [{ machine_id: 'A', display_position: 'left', label: '机器 A' }],
  advice_timing: 'none',
  material_version: '0.3.0',
};

export const REJECTED_SESSION: SessionInput = {
  session_id: '',
  participant_id: 'part-fixture-bad',
  recruitment_batch: 'batch-2026-09-17',
  group_assignment: 'A1',
  study_id: 'paper2-slot-prototype',
  protocol_version: 'unreleased',
  material_version: '0.3.0',
  contract_version: '0.3.0',
  adapter_version: '0.3.0',
  provider: 'local-demo',
  metadata: {
    participation_mode: 'on_site',
    device_class: 'desktop',
    recruitment_batch: 'batch-2026-09-17',
    adapter_version: '0.3.0',
    provider: 'local-demo',
  },
};

export const REJECTED_EXPERIMENT_STATE: ExperimentStateInput = {
  session_id: 'sess-fixture-bad',
  phase: 'calibration',
  trial_index: -1,
  last_confirmed_event_id: null,
  last_confirmed_sequence_no: 0,
  completed: false,
  reconciliation_required: false,
};

export const REJECTED_SAVE_RECEIPT: SaveReceiptInput = {
  acknowledged_event_ids: ['not-a-uuid'],
  rejected_events: [],
  unconfirmed_event_ids: [],
  persistence_scope: 'remote',
  session_status: 'in_progress',
  persisted_at: FIXTURE_TIMESTAMPS.baseline,
  receipt_id: 'rcpt-001',
  current_phase: 'calibration',
};

export const REJECTED_CAPABILITIES: CapabilitiesInput = {
  provider: '',
  adapter_version: '',
  capabilities: {
    persistentResults: 'supported',
    idempotentWrites: 'supported',
    resumeSession: 'unsupported',
    serverControlledTrials: 'supported',
    serverScoring: 'unsupported',
    individualEntryCodes: 'unverified',
  },
};
