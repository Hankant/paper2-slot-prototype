/** Stable public reconciliation reference; never an authentication credential. */
export function rewardCode(sessionId: string): string {
  return `P2-${sessionId.toUpperCase()}`;
}
