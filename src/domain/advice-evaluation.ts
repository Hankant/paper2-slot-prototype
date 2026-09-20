/** Descriptive comparisons, not a causal measure of adoption or trust. */
export interface AdviceEvaluation {
  evaluation_version: '1.0.0';
  advice_exposed: boolean;
  advice_target_machine_id: string | null;
  advice_correct: boolean | null;
  independent_matches_advice: boolean | null;
  final_matches_advice: boolean | null;
  switched_to_advice: boolean | null;
  legacy_target_hit_reason: 'undefined_legacy_field';
}
export function evaluateAdvice(input: {
  exposed: boolean;
  target: string;
  winner: string;
  independent: string;
  final: string;
}): AdviceEvaluation {
  const { exposed, target, winner, independent, final } = input;
  return {
    evaluation_version: '1.0.0',
    advice_exposed: exposed,
    advice_target_machine_id: exposed ? target : null,
    advice_correct: exposed ? target === winner : null,
    independent_matches_advice: exposed ? independent === target : null,
    final_matches_advice: exposed ? final === target : null,
    switched_to_advice: exposed ? independent !== target && final === target : null,
    legacy_target_hit_reason: 'undefined_legacy_field',
  };
}
