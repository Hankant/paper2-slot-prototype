import { describe, expect, it } from 'vitest';

import { publicTrialSchema, slotMachineSchema } from '../../src/contracts/validators.js';
import { REJECTED_PUBLIC_TRIAL, SUCCESS_PUBLIC_TRIAL } from '../fixtures/session-fixtures.js';

describe('contracts: publicTrial', () => {
  it('accepts hidden metadata only and rejects hidden advice content', () => {
    const hidden = { advice_id: 'advice-001', revealed: false };
    expect(publicTrialSchema.parse({ ...SUCCESS_PUBLIC_TRIAL, advice: hidden }).advice).toEqual(
      hidden,
    );
    expect(
      publicTrialSchema.safeParse({ ...SUCCESS_PUBLIC_TRIAL, advice: { ...hidden, copy: 'B' } })
        .success,
    ).toBe(false);
  });
  it('accepts a well-formed public trial fixture with an advice block', () => {
    const parsed = publicTrialSchema.parse(SUCCESS_PUBLIC_TRIAL);
    expect(parsed.trial_id).toBe('trial-001');
    expect(parsed.machines).toHaveLength(3);
    expect(parsed.machines.map((m) => m.display_position)).toEqual(['left', 'center', 'right']);
    expect(parsed.advice_timing).toBe('after_choice');
    expect(parsed.advice?.revealed).toBe(true);
    if (parsed.advice?.revealed) {
      expect(parsed.advice.advice_target_machine_id).toBe('B');
      expect(parsed.advice.advice_target_display_position).toBe('center');
    }
  });

  it('rejects a trial whose visible history carries impossible hit rates', () => {
    const result = publicTrialSchema.safeParse(REJECTED_PUBLIC_TRIAL);
    expect(result.success).toBe(false);
  });

  it('rejects machines with unknown display position', () => {
    const result = slotMachineSchema.safeParse({
      machine_id: 'X',
      display_position: 'bottom-right',
      label: 'X',
    });
    expect(result.success).toBe(false);
  });

  it('treats visible_history as public-only: no private seeds leak', () => {
    const parsed = publicTrialSchema.parse(SUCCESS_PUBLIC_TRIAL);
    type Keys = keyof typeof parsed;
    const allowedKeys: ReadonlyArray<Keys> = [
      'trial_id',
      'trial_index',
      'phase',
      'visible_history',
      'machines',
      'advice_timing',
      'advice',
      'material_version',
      'performance_reference',
    ];
    expect(Object.keys(parsed).sort()).toEqual([...allowedKeys].sort());
  });

  it('rejects a trial with duplicate machine_id values (post-R6)', () => {
    const machine = SUCCESS_PUBLIC_TRIAL.machines[0];
    expect(
      machine !== undefined,
      'fixture must have a machine available for the duplicate test',
    ).toBe(true);
    if (machine === undefined) return;
    const result = publicTrialSchema.safeParse({
      ...SUCCESS_PUBLIC_TRIAL,
      machines: [machine, machine, machine],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a trial with duplicate display_position values (post-R6)', () => {
    const machine = SUCCESS_PUBLIC_TRIAL.machines[0];
    const machineAlt = {
      ...machine,
      machine_id: 'Z',
    };
    const result = publicTrialSchema.safeParse({
      ...SUCCESS_PUBLIC_TRIAL,
      machines: [machine, machineAlt, machine],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an advice block that names a machine outside `machines`', () => {
    const result = publicTrialSchema.safeParse({
      ...SUCCESS_PUBLIC_TRIAL,
      advice: {
        ...(SUCCESS_PUBLIC_TRIAL.advice ?? {}),
        advice_target_machine_id: 'ZZ',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects advice presence when advice_timing === "none"', () => {
    const result = publicTrialSchema.safeParse({
      ...SUCCESS_PUBLIC_TRIAL,
      advice_timing: 'none',
    });
    expect(result.success).toBe(false);
  });
});
