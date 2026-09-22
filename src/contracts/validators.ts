/**
 * Runtime validators for the public envelope and trial payloads.
 *
 * After the Q G0 review (R1–R6), this module enforces:
 *   - event envelope keeps its `payload` field round-trip; payload shape is
 *     discriminated by `event_type`
 *   - trial-level events MUST carry `trial_id`; entry-level events MUST NOT
 *   - SaveReceipt scopes are consistent (`remote` ⇔ persisted_at+receipt_id)
 *   - SaveReceipt event-id sets are pairwise disjoint and internally unique
 *   - PublicTrial machines carry unique `machine_id` and `display_position`
 *     and reference a real machine in the advice target
 */

import { z } from 'zod';

import { CHAT_STREAM_ERROR_CODES } from './chat-events.js';
import { CHAT_SOURCE_CHOICES_FOR_INVOCATION } from './chat-service.js';
import { CAPABILITY_KEYS } from './capabilities.js';
import type { EventEnvelope } from './envelopes.js';
import { ERROR_CODES } from './errors.js';
import {
  DEVICE_CLASSES,
  ENTRY_LEVEL_EVENTS,
  EXPERIMENT_EVENT_TYPES,
  PARTICIPATION_MODES,
  TRIAL_LEVEL_EVENTS,
} from './envelopes.js';
import { PERSISTENCE_SCOPES, SESSION_STATUSES } from './persistence-types.js';
import { SEMVER_TAG_PATTERN } from './protocol-versions.js';
import { SOURCE_CHOICES } from './trial-types.js';

const semverTag = z.string().regex(SEMVER_TAG_PATTERN, 'expected semver tag');

const participationMode = z.enum(PARTICIPATION_MODES);
const deviceClass = z.enum(DEVICE_CLASSES);
const phase = z.enum([
  'entry',
  'consent',
  'profile',
  'instructions',
  'practice',
  'calibration',
  'main',
  'finalizing',
  'completed',
  'cancelled',
]);
const eventType = z.enum(EXPERIMENT_EVENT_TYPES);
const persistenceScope = z.enum(PERSISTENCE_SCOPES);
const sessionStatus = z.enum(SESSION_STATUSES);
const errorCode = z.enum(ERROR_CODES);
const sourceChoice = z.enum(SOURCE_CHOICES);

const slotDisplayPosition = z.enum(['left', 'center', 'right']);

const baseEnvelopeShape = {
  schema_version: semverTag,
  contract_version: semverTag,
  protocol_version: z.string().min(1),
  material_version: z.string().min(1),
  client_version: semverTag,
  session_id: z.string().min(1),
  participant_id: z.string().min(1),
  event_id: z.string().uuid(),
  sequence_no: z.number().int().nonnegative(),
  phase,
  event_type: eventType,
  client_timestamp: z.string().datetime(),
  elapsed_ms: z.number().int().nonnegative(),
} as const;

/**
 * Per-event-type payload schemas. Returning a schema (not `null`) means
 * the payload is required and validated; `null` means the event may omit
 * the payload (entry-level scaffolding events).
 */
const payloadSchemas: Readonly<Record<z.infer<typeof eventType>, z.ZodTypeAny | null>> = {
  consent_recorded: z.object({
    version: z.string().min(1),
  }),
  practice_completed: z
    .object({
      practice_version: z.string().min(1),
      condition_id: z.string().min(1),
      human_average_hit_rate: z.number().min(0).max(1),
      ai_hit_rate: z.number().min(0).max(1),
      ai_accuracy_tier: z.string().min(1),
      points_per_correct: z.number().int().min(0),
      reward_per_point_cny: z.number().min(0).nullable(),
      trials: z
        .array(
          z.object({
            practice_trial_id: z.string().min(1),
            predicted_machine_id: z.string().min(1),
            actual_winner_machine_id: z.string().min(1),
            correct: z.boolean(),
            points_awarded: z.number().int().min(0),
            response_ms: z.number().int().nonnegative(),
          }),
        )
        .min(1),
      total_points: z.number().int().min(0),
    })
    .strict(),
  profile_submitted: z.object({
    fields: z.record(z.string(), z.unknown()),
  }),
  comprehension_answered: z.object({
    question_id: z.string().min(1),
    answer: z.unknown(),
    correct: z.boolean().nullable(),
  }),
  prediction_submitted: z.object({
    machine_id: z.string().min(1),
    display_position: slotDisplayPosition,
  }),
  confidence_submitted: z.object({
    confidence_percent: z.number().int().min(0).max(100),
  }),
  source_selected: z
    .object({
      source: sourceChoice,
    })
    .strict(),
  final_prediction_submitted: z.object({
    machine_id: z.string().min(1),
    display_position: slotDisplayPosition,
    changed_after_advice: z.boolean(),
  }),
  advice_revealed: z.object({
    advice_id: z.string().min(1),
    revealed_at_phase: phase,
  }),
  feedback_presented: z.object({
    presented_at_ms: z.number().int().nonnegative(),
  }),
  visibility_changed: z.object({
    element_id: z.string().min(1),
    visible: z.boolean(),
  }),
  questionnaire_block_submitted: z.object({
    block_id: z.string().min(1),
    instrument_version: z.string().min(1),
    wording_profile: z.enum(['SELF_AI', 'HUMAN_AI']),
    position: z.enum(['pre', 'post']),
    item_order: z.array(z.string().min(1)).min(1),
    responses: z
      .array(
        z.object({
          item_id: z.string().min(1),
          value: z.union([z.string(), z.number(), z.array(z.string())]).nullable(),
          skipped: z.boolean(),
          response_ms: z.number().int().nonnegative(),
        }),
      )
      .min(1),
  }),
  session_completion_requested: z.object({
    ack_required_event_count: z.number().int().nonnegative(),
  }),
};

const payloadValidatorsByEventType = new Map<z.infer<typeof eventType>, z.ZodTypeAny | null>(
  EXPERIMENT_EVENT_TYPES.map((type) => [type, payloadSchemas[type]] as const),
);

export const slotMachineSchema = z
  .object({
    machine_id: z.string().min(1),
    display_position: slotDisplayPosition,
    label: z.string().min(1),
  })
  .readonly();

export const revealedAdviceBlockSchema = z
  .object({
    advice_id: z.string().min(1),
    advice_target_machine_id: z.string().min(1),
    advice_target_display_position: slotDisplayPosition,
    copy: z.string().min(1),
    revealed: z.literal(true),
  })
  .strict();

export const hiddenAdviceBlockSchema = z
  .object({
    advice_id: z.string().min(1),
    revealed: z.literal(false),
  })
  .strict();

export const publicAdviceBlockSchema = z
  .discriminatedUnion('revealed', [hiddenAdviceBlockSchema, revealedAdviceBlockSchema])
  .readonly();

function uniqueBy<T, K>(items: ReadonlyArray<T>, key: (item: T) => K): boolean {
  const seen = new Set<K>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

export const publicTrialSchema = z
  .object({
    trial_id: z.string().min(1),
    trial_index: z.number().int().nonnegative(),
    phase: z.enum(['practice', 'calibration', 'main']),
    visible_history: z
      .array(
        z.object({
          trial_id: z.string().min(1),
          machine_id: z.string().min(1),
          observed_hit_rate: z.number().min(0).max(1),
        }),
      )
      .readonly(),
    machines: z.array(slotMachineSchema).min(1).readonly(),
    advice_timing: z.enum(['before_choice', 'after_choice', 'none']),
    advice: publicAdviceBlockSchema.optional(),
    material_version: semverTag,
    performance_reference: z
      .object({
        condition_id: z.string().min(1),
        human_average_hit_rate: z.number().min(0).max(1),
        ai_hit_rate: z.number().min(0).max(1),
        ai_accuracy_tier: z.string().min(1),
        points_per_correct: z.number().int().min(0),
        reward_per_point_cny: z.number().min(0).nullable(),
      })
      .strict(),
  })
  .superRefine((value, ctx) => {
    if (!uniqueBy(value.machines, (m) => m.machine_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PublicTrial.machines machine_id values must be unique',
        path: ['machines'],
      });
    }
    if (!uniqueBy(value.machines, (m) => m.display_position)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PublicTrial.machines display_position values must be unique',
        path: ['machines'],
      });
    }
    if (value.advice_timing === 'none' && value.advice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PublicTrial.advice must be omitted when advice_timing === "none"',
        path: ['advice'],
      });
    }
    if (value.advice?.revealed === true) {
      const advice = value.advice;
      const referenced = value.machines.find(
        (m) => m.machine_id === advice.advice_target_machine_id,
      );
      if (referenced === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'PublicTrial.advice.advice_target_machine_id is not in machines',
          path: ['advice', 'advice_target_machine_id'],
        });
      } else if (referenced.display_position !== value.advice.advice_target_display_position) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'PublicTrial.advice.advice_target_display_position does not match machines entry',
          path: ['advice', 'advice_target_display_position'],
        });
      }
    }
  });

export const participantPredictionSchema = z
  .object({
    machine_id: z.string().min(1),
    display_position: slotDisplayPosition,
    confidence_percent: z.number().int().min(0).max(100),
    elapsed_ms: z.number().int().nonnegative(),
  })
  .readonly();

export const finalPredictionRecordSchema = z
  .object({
    independent: participantPredictionSchema,
    final: participantPredictionSchema,
    source_choice: sourceChoice,
    changed_after_advice: z.boolean(),
  })
  .readonly();

export const trialFeedbackSchema = z
  .object({
    trial_id: z.string().min(1),
    actual_winner_machine_id: z.string().min(1),
    participant_predicted_winner: z.boolean(),
    advice_target_hit: z.boolean().nullable(),
    advice_actual_hit: z.boolean().nullable(),
    advice_evaluation: z
      .object({
        evaluation_version: z.literal('1.0.0'),
        advice_exposed: z.boolean(),
        advice_target_machine_id: z.string().min(1).nullable(),
        advice_correct: z.boolean().nullable(),
        independent_matches_advice: z.boolean().nullable(),
        final_matches_advice: z.boolean().nullable(),
        switched_to_advice: z.boolean().nullable(),
        legacy_target_hit_reason: z.literal('undefined_legacy_field'),
      })
      .optional(),
    points_awarded: z.number().int(),
    scoring_version: semverTag,
    independent_correct: z.boolean(),
    final_correct: z.boolean(),
    required_event_types: z
      .array(z.enum(EXPERIMENT_EVENT_TYPES))
      .min(1)
      .refine(
        (types) => !types.includes('feedback_presented'),
        'Feedback cannot require its own presentation',
      )
      .readonly(),
  })
  .readonly();

export const entryCredentialSchema = z.object({
  entry_code: z.string().min(8, 'entry_code must be at least 8 chars'),
  observed_participation_mode: participationMode,
  observed_device_class: deviceClass,
  client_versions: z.object({
    protocol_version: z.string().min(1),
    contract_version: semverTag,
    material_version: semverTag,
    client_version: semverTag,
  }),
});

export const sessionMetadataSchema = z.object({
  participation_mode: participationMode,
  device_class: deviceClass,
  recruitment_batch: z.string().min(1),
  adapter_version: z.string().min(1),
  provider: z.string().min(1),
});

export const sessionSchema = z.object({
  session_id: z.string().min(1),
  participant_id: z.string().min(1),
  recruitment_batch: z.string().min(1),
  group_assignment: z.string().min(1),
  study_id: z.string().min(1),
  protocol_version: z.string().min(1),
  material_version: semverTag,
  contract_version: semverTag,
  adapter_version: z.string().min(1),
  provider: z.string().min(1),
  condition_assignment: z
    .object({
      condition_id: z.string().min(1),
      human_average_hit_rate: z.number().min(0).max(1),
      ai_hit_rate: z.number().min(0).max(1),
      ai_accuracy_tier: z.string().min(1),
      points_per_correct: z.number().int().min(0),
      reward_per_point_cny: z.number().min(0).nullable(),
    })
    .strict()
    .optional(),
  metadata: sessionMetadataSchema,
});

export const experimentStateSchema = z.object({
  session_id: z.string().min(1),
  phase,
  trial_index: z.number().int().nonnegative(),
  last_confirmed_event_id: z.string().min(1).nullable(),
  last_confirmed_sequence_no: z.number().int().nonnegative(),
  completed: z.boolean(),
  reconciliation_required: z.boolean(),
});

export const eventEnvelopeSchema = z
  .object({
    ...baseEnvelopeShape,
    trial_id: z.string().min(1).optional(),
    payload: z.unknown(),
  })
  .superRefine((value, ctx) => {
    const event_type = (value as { event_type: z.infer<typeof eventType> }).event_type;
    const trial_id = (value as { trial_id?: string | undefined }).trial_id;
    const payload = (value as { payload: unknown }).payload;

    if ((TRIAL_LEVEL_EVENTS as readonly string[]).includes(event_type) && trial_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trial_id is required for ${event_type}`,
        path: ['trial_id'],
      });
    }
    if ((ENTRY_LEVEL_EVENTS as readonly string[]).includes(event_type) && trial_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${event_type} must not carry trial_id`,
        path: ['trial_id'],
      });
    }

    const schema = payloadValidatorsByEventType.get(event_type) ?? null;
    if (schema === null) {
      if (payload !== undefined && payload !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${event_type} must not carry a payload`,
          path: ['payload'],
        });
      }
      return;
    }

    if (payload === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${event_type} requires a payload`,
        path: ['payload'],
      });
      return;
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `payload does not match ${event_type} shape: ${issue.message}`,
          path: ['payload', ...issue.path],
        });
      }
    }
  });

/** Narrow only after the per-event payload and envelope checks have succeeded. */
export function parseEventEnvelope(value: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(value) as EventEnvelope;
}

export const rejectedEventRecordSchema = z.object({
  event_id: z.string().uuid(),
  reason_code: z.string().min(1),
  reason_message: z.string(),
});

export const saveReceiptSchema = z
  .object({
    acknowledged_event_ids: z.array(z.string().uuid()).readonly(),
    rejected_events: z.array(rejectedEventRecordSchema).readonly(),
    unconfirmed_event_ids: z.array(z.string().uuid()).readonly(),
    persistence_scope: persistenceScope,
    session_status: sessionStatus,
    persisted_at: z.string().datetime().nullable(),
    receipt_id: z.string().min(1).nullable(),
    current_phase: phase,
  })
  .superRefine((value, ctx) => {
    if (!uniqueBy(value.acknowledged_event_ids, (id) => id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'acknowledged_event_ids must be unique within the receipt',
        path: ['acknowledged_event_ids'],
      });
    }
    if (!uniqueBy(value.rejected_events, (r) => r.event_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rejected_events event_id values must be unique within the receipt',
        path: ['rejected_events'],
      });
    }
    if (!uniqueBy(value.unconfirmed_event_ids, (id) => id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unconfirmed_event_ids must be unique within the receipt',
        path: ['unconfirmed_event_ids'],
      });
    }

    const acked = new Set(value.acknowledged_event_ids);
    const rejectedIds = new Set(value.rejected_events.map((r) => r.event_id));
    const unconfirmed = new Set(value.unconfirmed_event_ids);
    const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>, label: string): void => {
      for (const id of a) {
        if (b.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `event_id ${id} appears in ${label} and another list`,
            path: ['acknowledged_event_ids'],
          });
        }
      }
    };
    overlap(acked, rejectedIds, 'acknowledged');
    overlap(acked, unconfirmed, 'acknowledged');
    overlap(rejectedIds, unconfirmed, 'rejected_events');

    if (value.persistence_scope === 'remote') {
      if (value.persisted_at === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'persistence_scope=remote requires persisted_at to be non-null',
          path: ['persisted_at'],
        });
      }
      if (value.receipt_id === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'persistence_scope=remote requires receipt_id to be non-null',
          path: ['receipt_id'],
        });
      }
    } else {
      if (value.persisted_at !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `persistence_scope=${value.persistence_scope} requires persisted_at to be null`,
          path: ['persisted_at'],
        });
      }
      if (value.receipt_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `persistence_scope=${value.persistence_scope} requires receipt_id to be null`,
          path: ['receipt_id'],
        });
      }
    }
  });

const capabilityStatus = z.enum(['supported', 'unsupported', 'unverified']);

const capabilityMapSchema = z
  .object(
    Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, capabilityStatus])) as Record<
      (typeof CAPABILITY_KEYS)[number],
      typeof capabilityStatus
    >,
  )
  .readonly();

export const capabilitiesSchema = z.object({
  provider: z.string().min(1),
  adapter_version: z.string().min(1),
  capabilities: capabilityMapSchema,
});

export const contractErrorSchema = z.object({
  code: errorCode,
  message: z.string(),
  retryable: z.enum(['retry', 'no-retry', 'user-action']),
  details: z.record(z.unknown()).optional(),
});

/* Demo configuration schema — kept here so the loader can lean on the same
 * runtime validator as the rest of the public contract surface. */
export const sourceChoiceLiteral = z.enum(SOURCE_CHOICES);

export const demoConfigSchema = z
  .object({
    config_version: z.string().min(1),
    simulation: z.literal(true),
    provider: z.string().min(1),
    study_id: z.string().min(1),
    contract_version: semverTag,
    protocol_version: z.string().min(1),
    material_version: semverTag,
    adapter_version: z.string().min(1),
    client_version: semverTag,
    entry_code_placeholder: z.string().min(1),
    task_definition: z.string().min(1),
    phase_order: z.array(z.string()).min(1),
    trial_phases: z.array(z.string()).min(1),
    advice_timing: z.enum(['before_choice', 'after_choice', 'none']),
    machines_per_trial: z.number().int().min(1),
    machine_assignment_strategy: z.string().min(1),
    feedback_mode: z.enum(['after_each_trial', 'delayed']),
    point_system: z.object({
      scheme: z.string().min(1),
      correct_prediction_points: z.number().int().min(0),
      incorrect_prediction_points: z.number().int(),
      no_real_money: z.literal(true),
    }),
    personal_data: z.object({
      fields: z.array(z.string()).readonly(),
      retention_days: z.number().int().min(0),
      retention_note: z.string().min(1).optional(),
      no_real_personal_data: z.literal(true),
    }),
    capabilities: capabilityMapSchema,
    research_decisions_that_remain_tbd: z.array(z.string()).readonly(),
    phase_trial_counts: z
      .object({
        practice: z.number().int().min(0),
        calibration: z.number().int().min(0),
        main: z.number().int().min(0),
      })
      .optional(),
  })
  .strict();

export type PublicTrialInput = z.input<typeof publicTrialSchema>;
export type EntryCredentialInput = z.input<typeof entryCredentialSchema>;
export type SessionInput = z.input<typeof sessionSchema>;
export type ExperimentStateInput = z.input<typeof experimentStateSchema>;
export type EventEnvelopeInput = z.input<typeof eventEnvelopeSchema>;
export type SaveReceiptInput = z.input<typeof saveReceiptSchema>;
export type CapabilitiesInput = z.input<typeof capabilitiesSchema>;
export type DemoConfigInput = z.input<typeof demoConfigSchema>;
export type TrialFeedbackInput = z.input<typeof trialFeedbackSchema>;
export type PublicAdviceBlockInput = z.input<typeof publicAdviceBlockSchema>;
export type FinalPredictionRecordInput = z.input<typeof finalPredictionRecordSchema>;

/* ----- 0.4.0-rc: streaming chat (U0 contract freeze, no impl yet) ----- */

const chatStreamErrorCodeSchema = z.enum(CHAT_STREAM_ERROR_CODES);
const chatSourceChoiceForInvocationSchema = z.enum([...CHAT_SOURCE_CHOICES_FOR_INVOCATION] as [
  string,
  ...string[],
]);

/** sha256 hex, exactly 64 lowercase hex characters. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** UUID v4 — used for `request_id`, `message_id`, `event_id`. */
const uuidV4 = z.string().uuid();

const chatMessageMetaSchema = z
  .object({
    message_id: uuidV4,
    request_id: uuidV4,
    author: z.enum(['assistant']).nullable(),
    opened_at: z.string().datetime(),
    adapter_version: z.string().min(1),
  })
  .readonly();

const chatStreamEventBaseFields = {
  event_id: uuidV4,
  schema_version: semverTag,
  contract_version: semverTag,
  client_version: semverTag,
  material_version: semverTag,
  protocol_version: z.string().min(1),
  request_id: uuidV4,
  message_meta: chatMessageMetaSchema,
  server_timestamp: z.string().datetime().nullable(),
} as const;

export const chatStreamEventStartedSchema = z.object({
  ...chatStreamEventBaseFields,
  type: z.literal('started'),
  sequence: z.literal(-1),
});

export const chatStreamEventTextDeltaSchema = z.object({
  ...chatStreamEventBaseFields,
  type: z.literal('text_delta'),
  sequence: z.number().int().min(0),
  text: z.string().min(1).max(4096),
  author: z.enum(['assistant']).nullable(),
});

export const chatStreamEventCompletedSchema = z.object({
  ...chatStreamEventBaseFields,
  type: z.literal('completed'),
  sequence: z.literal(-1),
  content_hash: sha256Hex,
  total_text_deltas: z.number().int().min(0),
  final: z.literal(true),
});

export const chatStreamEventCancelledSchema = z.object({
  ...chatStreamEventBaseFields,
  type: z.literal('cancelled'),
  sequence: z.literal(-1),
  last_sequence: z.number().int().min(-1),
});

export const chatStreamEventFailedSchema = z.object({
  ...chatStreamEventBaseFields,
  type: z.literal('failed'),
  sequence: z.literal(-1),
  code: chatStreamErrorCodeSchema,
  retryable: z.boolean(),
  error_message: z.string().min(1).max(2000),
});

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  chatStreamEventStartedSchema,
  chatStreamEventTextDeltaSchema,
  chatStreamEventCompletedSchema,
  chatStreamEventCancelledSchema,
  chatStreamEventFailedSchema,
]);

export type ChatStreamEventStartedInput = z.input<typeof chatStreamEventStartedSchema>;
export type ChatStreamEventTextDeltaInput = z.input<typeof chatStreamEventTextDeltaSchema>;
export type ChatStreamEventCompletedInput = z.input<typeof chatStreamEventCompletedSchema>;
export type ChatStreamEventCancelledInput = z.input<typeof chatStreamEventCancelledSchema>;
export type ChatStreamEventFailedInput = z.input<typeof chatStreamEventFailedSchema>;
export type ChatStreamEventInput = z.input<typeof chatStreamEventSchema>;

export const chatRequestSchema = z
  .object({
    session_id: z.string().min(1),
    trial_id: z.string().min(1),
    advice_id: z.string().min(1),
    request_id: uuidV4,
    user_text: z
      .string()
      .min(1, 'user_text must not be empty or whitespace-only')
      .regex(/\S/, 'user_text must not be whitespace-only')
      .max(2000, 'user_text must not exceed 2000 chars'),
    source_choice: chatSourceChoiceForInvocationSchema,
    locale: z.string().min(2).max(35),
    user_text_chars: z.number().int().min(1).max(2000),
    client_versions: z.object({
      contract_version: semverTag,
      material_version: semverTag,
      client_version: semverTag,
      protocol_version: z.string().min(1),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.user_text_chars !== value.user_text.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'user_text_chars must equal user_text.length',
        path: ['user_text_chars'],
      });
    }
    if (value.user_text.trim().length !== value.user_text.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'user_text must be pre-trimmed by the client',
        path: ['user_text'],
      });
    }
  })
  .readonly();

export type ChatRequestInput = z.input<typeof chatRequestSchema>;

export type ChatStreamEventSequence = z.infer<typeof chatStreamEventSchema>;

/** Compile-time guarantees used by tests and adapters. */
export type ChatStreamEventByType = {
  started: z.infer<typeof chatStreamEventStartedSchema>;
  text_delta: z.infer<typeof chatStreamEventTextDeltaSchema>;
  completed: z.infer<typeof chatStreamEventCompletedSchema>;
  cancelled: z.infer<typeof chatStreamEventCancelledSchema>;
  failed: z.infer<typeof chatStreamEventFailedSchema>;
};

/* static re-exports preserve type-only usage in the barrel. */
export type { ChatStreamEvent, ChatStreamEventType, ChatStreamErrorCode } from './chat-events.js';
export type { SourceChoice } from './trial-types.js';
export { CHAT_STREAM_EVENT_TYPES } from './chat-events.js';
