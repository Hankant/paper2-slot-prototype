/**
 * Loader for `config/demo.json`.
 *
 * After the Q G0 review (R5), this loader rejects malformed demo input at
 * runtime instead of leaning on a TypeScript `as` cast. Negative trial
 * counts, `no_real_personal_data: false`, missing required enums, and
 * version mismatches all surface as thrown errors so the bootstrap cannot
 * silently swallow bad config.
 */

import demoConfigRaw from './demo.json' with { type: 'json' };

import {
  DEMO_CONFIG_VERSION,
  capabilityMapEquals,
  demoConfigSchema,
  satisfiesRequired,
  type CapabilityMap,
  type PersistenceScope,
} from '../src/contracts/index.js';

const rawParse = demoConfigSchema.safeParse(demoConfigRaw);
if (!rawParse.success) {
  const issueSummary = rawParse.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`config/demo.json failed schema validation: ${issueSummary}`);
}

/** Wire shape — snake_case. Zod has already validated all fields. */
const demoConfigWire = rawParse.data;

if (demoConfigWire.config_version !== DEMO_CONFIG_VERSION) {
  throw new Error(
    `Demo config version drift: ${demoConfigWire.config_version} vs ${DEMO_CONFIG_VERSION}. ` +
      'Update DEMO_CONFIG_VERSION in src/contracts/protocol-versions.ts and re-run tests.',
  );
}

/**
 * Internal camelCase view for B/C/D convenience. Each field is a known
 * validated string / number / boolean after `demoConfigSchema.parse`; the
 * mapping is mechanical so it does not need a type assertion, but each
 * derived field still goes through a defensive cast on the wire JSON.
 */
export interface DemoConfig {
  readonly configVersion: string;
  readonly simulation: true;
  readonly provider: string;
  readonly studyId: string;
  readonly contractVersion: string;
  readonly protocolVersion: string;
  readonly materialVersion: string;
  readonly adapterVersion: string;
  readonly clientVersion: string;
  readonly entryCodePlaceholder: string;
  readonly taskDefinition: string;
  readonly phaseOrder: ReadonlyArray<string>;
  readonly trialPhases: ReadonlyArray<string>;
  readonly adviceTiming: 'before_choice' | 'after_choice' | 'none';
  readonly machinesPerTrial: number;
  readonly machineAssignmentStrategy: string;
  readonly feedbackMode: 'after_each_trial' | 'delayed';
  readonly pointSystem: {
    readonly scheme: string;
    readonly correctPredictionPoints: number;
    readonly incorrectPredictionPoints: number;
    readonly noRealMoney: true;
  };
  readonly personalData: {
    readonly fields: ReadonlyArray<string>;
    readonly retentionDays: number;
    readonly noRealPersonalData: true;
  };
  readonly capabilities: CapabilityMap;
  readonly researchDecisionsThatRemainTbd: ReadonlyArray<string>;
  readonly phaseTrialCounts?: Readonly<Record<'practice' | 'calibration' | 'main', number>>;
}

function asCamelDemoConfig(wire: typeof demoConfigWire): DemoConfig {
  const base = {
    configVersion: wire.config_version,
    simulation: true,
    provider: wire.provider,
    studyId: wire.study_id,
    contractVersion: wire.contract_version,
    protocolVersion: wire.protocol_version,
    materialVersion: wire.material_version,
    adapterVersion: wire.adapter_version,
    clientVersion: wire.client_version,
    entryCodePlaceholder: wire.entry_code_placeholder,
    taskDefinition: wire.task_definition,
    phaseOrder: [...wire.phase_order],
    trialPhases: [...wire.trial_phases],
    adviceTiming: wire.advice_timing,
    machinesPerTrial: wire.machines_per_trial,
    machineAssignmentStrategy: wire.machine_assignment_strategy,
    feedbackMode: wire.feedback_mode,
    pointSystem: {
      scheme: wire.point_system.scheme,
      correctPredictionPoints: wire.point_system.correct_prediction_points,
      incorrectPredictionPoints: wire.point_system.incorrect_prediction_points,
      noRealMoney: true,
    },
    personalData: {
      fields: [...wire.personal_data.fields],
      retentionDays: wire.personal_data.retention_days,
      noRealPersonalData: true,
    },
    capabilities: wire.capabilities,
    researchDecisionsThatRemainTbd: [...wire.research_decisions_that_remain_tbd],
  } as const;
  if (wire.phase_trial_counts === undefined) {
    return base;
  }
  return {
    ...base,
    phaseTrialCounts: Object.freeze({
      practice: wire.phase_trial_counts.practice,
      calibration: wire.phase_trial_counts.calibration,
      main: wire.phase_trial_counts.main,
    }),
  };
}

export const demoConfiguration: DemoConfig = asCamelDemoConfig(demoConfigWire);

/** Convenience helpers reused by B/C/D adapters. */
export function demoCapabilitiesSatisfyProduction(): boolean {
  return satisfiesRequired(demoConfiguration.capabilities);
}

export function demoCapabilitiesEqual(other: CapabilityMap): boolean {
  return capabilityMapEquals(demoConfiguration.capabilities, other);
}

/**
 * Hard-asserted copy-pasteable banner rendered by every demo page so a
 * reviewer cannot mistake the run for production data collection. The
 * wording is intentionally honest about the G0 state: no real adapter
 * is wired yet, no real data is collected.
 */
export const DEMO_BANNER_TEXT =
  'SIMULATION ONLY — no real participant data is collected. ' +
  'Demo adapter is not yet wired; this G0 mount only renders the frozen ' +
  'contract version and the demo configuration.';

export type { PersistenceScope };
