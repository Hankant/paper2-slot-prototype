/** Original SVG reel artwork. All markup is static, never participant/model text. */
const drawings: Record<string, string> = {
  cherry:
    '<path d="M34 49Q48 20 58 14Q54 45 63 53" fill="none" stroke="#556641" stroke-width="4"/><path d="M56 17Q33 8 27 25Q45 34 56 17" fill="#718653"/><path d="M57 17Q69 8 79 16Q70 27 57 17" fill="#849958"/><circle cx="31" cy="59" r="18" fill="#a32f34"/><circle cx="62" cy="65" r="18" fill="#bb3b3b"/><path d="M20 52q2-7 8-7M51 59q2-7 8-7" stroke="#ed9b8f" stroke-width="4" stroke-linecap="round"/>',
  lemon:
    '<path d="M24 34Q49 10 74 33L83 35L79 45Q69 77 37 79L27 85L24 74Q2 59 20 40Z" fill="#ebbe4c" stroke="#b89438" stroke-width="2"/><path d="M27 39Q42 21 62 30" stroke="#fff0a6" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M65 24Q70 7 88 16Q82 29 65 24" fill="#718653"/><path d="M74 23l7-11" stroke="#556641" stroke-width="3"/>',
  bell: '<circle cx="50" cy="20" r="7" fill="#be944e"/><path d="M27 55V43Q27 22 50 22Q73 22 73 43V55L84 72H16Z" fill="#d4aa60" stroke="#a17b3e" stroke-width="2"/><path d="M34 48V42Q35 31 43 30" fill="none" stroke="#fae4ad" stroke-width="5" stroke-linecap="round"/><path d="M17 70H83V78H17Z" fill="#b58b47"/><path d="M41 80Q50 94 59 80" fill="#8c6b35"/>',
};
export function symbol(name: string): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${drawings[name] ?? drawings.bell}</svg>`;
}
export const spark =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z" stroke="currentColor" stroke-width="1.6"/></svg>';
export const arrow =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
