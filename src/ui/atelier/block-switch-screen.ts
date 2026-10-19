/**
 * minimax (2026-09-23): BlockSwitchScreen — the inter-block transition
 * UI. Mirrors the visual language of `practice-overlay.ts` (topbar, shell,
 * footer, decision-area) so participants do not feel a context shift when
 * the experiment moves from the test block to the formal block.
 *
 * Two layouts are rendered from the same function:
 *   1. `block-intro` — shown when entering a block. Big number, intro
 *      notice, "进入本环节" CTA.
 *   2. `block-switch` — shown between blocks. Two-column layout: previous
 *      block summary on the left, next block intro on the right.
 *
 * Both layouts block automatic progression: the participant must click
 * the CTA to continue. This is the only place the participant has to
 * "actively transition" between blocks, so the visible affordance is
 * deliberately strong.
 */

import type { BlockSpec, BlockTransitionSpec } from '@contracts';
import { requireElement } from './dom.js';
import { symbol } from './symbols.js';
import type { BlockSummary } from '../../experiment/run-orchestrator.js';

export type SwitchScreenMode = 'intro' | 'switch';

export interface BlockSwitchScreenOptions {
  readonly root: HTMLElement;
  readonly mode: SwitchScreenMode;
  /** Current block (the one being entered or shown). */
  readonly block: BlockSpec;
  /** Only used in `switch` mode: the block we just finished. */
  readonly previousBlock?: BlockSpec | null;
  /** Only used in `switch` mode: the summary of the previous block. */
  readonly previousSummary?: BlockSummary | null;
  /** Title badge in the topbar; mirrors `entry-screen.ts`. */
  readonly badge?: string;
  /** When true, renders a CTA labelled "进入下一环节" rather than "开始本环节". */
  readonly isTransition?: boolean;
  /** Progress copy rendered in the topbar (e.g. "BLOCK 2 / 2"). */
  readonly progressLabel?: string;
  /** Score summary rendered next to the badge (test block only). */
  readonly excludedNotice?: string;
  /** Called when the participant clicks the CTA. */
  readonly onContinue: () => Promise<void> | void;
}

function fmtPoints(value: number): string {
  return `${value} 积分`;
}

function fmtRate(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function summaryBlock(
  previousBlock: BlockSpec | null | undefined,
  previousSummary: BlockSummary | null | undefined,
): string {
  if (!previousBlock || !previousSummary) return '';
  const rate =
    previousSummary.trials_completed === 0
      ? 0
      : previousSummary.correct_count / previousSummary.trials_completed;
  return `<section class="switch-summary" aria-label="上一环节成绩">
    <p class="eyebrow">上一环节 · ${previousBlock.display_label}</p>
    <h2>本环节结果</h2>
    <dl class="switch-stats">
      <div><dt>完成题数</dt><dd>${previousSummary.trials_completed} / ${previousBlock.total_trials}</dd></div>
      <div><dt>命中题数</dt><dd>${previousSummary.correct_count}（命中率 ${fmtRate(rate)}）</dd></div>
      <div><dt>本环节得分</dt><dd>${fmtPoints(previousSummary.total_points_earned)}</dd></div>
    </dl>
    <p class="switch-note">${
      previousBlock.scores_excluded_from_formal
        ? '测试环节得分不计入正式实验表现。'
        : '本环节得分将作为正式实验数据保存。'
    }</p>
  </section>`;
}

export function mountBlockSwitchScreen(options: BlockSwitchScreenOptions): void {
  if (options.mode === 'intro') {
    mountFullScreenIntro(options);
    return;
  }
  const root = options.root;
  const badge = options.badge ?? (options.isTransition ? '环节切换' : '进入环节');
  const progressLabel = options.progressLabel ?? '';
  const excluded = options.excludedNotice ?? '';
  const transition: BlockTransitionSpec = {
    from_block_id: options.previousBlock?.block_id ?? null,
    to_block_id: options.block.block_id,
    from_display_label: options.previousBlock?.display_label ?? null,
    to_display_label: options.block.display_label,
    summary: {
      trials_completed: options.previousSummary?.trials_completed ?? 0,
      correct_count: options.previousSummary?.correct_count ?? 0,
      total_points_earned: options.previousSummary?.total_points_earned ?? 0,
      had_source_choice: options.previousSummary?.had_source_choice ?? false,
    },
    next_intro_notice: options.block.intro_notice,
  };
  const fromColumn = summaryBlock(options.previousBlock, options.previousSummary);
  const isTest = options.block.block_kind === 'test';
  const blockBadge = isTest ? '测试环节' : '正式环节';
  const accentClass = isTest ? 'accent-test' : 'accent-formal';
  const summary = transition.summary;
  const summaryRate =
    summary.trials_completed === 0 ? 0 : summary.correct_count / summary.trials_completed;

  root.innerHTML = `<div class="experience switch-experience ${accentClass}">
    <header class="topbar">
      <a class="wordmark" href="./index.html"><span class="brand-mark">p.</span> PREDICTION LAB</a>
      <span class="demo-tag"><i></i>${badge}</span>
      <span class="block-counter">${blockBadge} · ${options.block.total_trials} 题</span>
      ${progressLabel === '' ? '' : `<span class="round-counter">${progressLabel}</span>`}
      ${excluded === '' ? '' : `<span class="switch-excluded">${excluded}</span>`}
    </header>
    <main class="switch-main">
      <div class="switch-banner">
        <span class="switch-symbol">${symbol('bell')}</span>
        <div>
          <p class="eyebrow">${
            options.isTransition ? '环节变更 · BLOCK TRANSITION' : '即将开始 · NEW BLOCK'
          }</p>
          <h1 tabindex="-1">${options.isTransition ? '切换到下一环节' : '进入 ' + options.block.display_label}</h1>
          <p class="switch-lead">
            ${
              options.isTransition
                ? '你已完成一个环节；下一环节的关键差异如下，请阅读后主动点击进入。'
                : '请阅读本环节说明，然后主动点击开始按钮进入。'
            }
          </p>
        </div>
      </div>
      <section class="switch-grid">
        ${fromColumn}
        <section class="switch-next" aria-label="下一环节说明">
          <p class="eyebrow">下一环节 · ${options.block.display_label}</p>
          <h2>${options.isTransition ? '即将开始' : '本环节说明'}</h2>
          <p class="switch-intro">${options.block.intro_notice}</p>
          <ul class="switch-keypoints">
            <li><b>本环节类型</b><span>${
              options.block.block_kind === 'test'
                ? '测试环节（不计正式成绩）'
                : '正式实验环节（数据将用于分析）'
            }</span></li>
            <li><b>本环节题数</b><span>${options.block.total_trials} 题</span></li>
            <li><b>上一环节命中率</b><span>${
              options.isTransition ? fmtRate(summaryRate) : '—（首次进入）'
            }</span></li>
          </ul>
          <div class="switch-actions">
            <button class="primary" id="block-continue">${
              options.isTransition ? '进入下一环节' : '开始本环节'
            } <span>→</span></button>
          </div>
          ${
            options.block.block_kind === 'test'
              ? '<p class="switch-foot">测试环节熟悉规则与操作；其表现不计入正式实验。</p>'
              : '<p class="switch-foot">正式环节开始后，请按自己的节奏作答。</p>'
          }
        </section>
      </section>
    </main>
    <footer class="experience-footer">
      <span>研究任务 · 多环节实验</span>
      <span>${blockBadge} · ${options.block.total_trials} 题</span>
    </footer>
  </div>`;

  window.scrollTo(0, 0);
  const heading = requireElement<HTMLHeadingElement>(root, 'h1');
  heading.focus({ preventScroll: true });
  const button = requireElement<HTMLButtonElement>(root, '#block-continue');
  button.onclick = () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在进入…';
    void Promise.resolve(options.onContinue()).catch((error) => {
      button.disabled = false;
      button.textContent = options.isTransition ? '进入下一环节 →' : '开始本环节 →';
      const banner = root.querySelector<HTMLElement>('.switch-foot');
      if (banner) {
        banner.textContent = error instanceof Error ? error.message : '暂时无法进入，请重试。';
      }
    });
  };
}

/** A dedicated confirmation page, before any trial controls become available. */
function mountFullScreenIntro(options: BlockSwitchScreenOptions): void {
  const { root, block } = options;
  const practice = block.block_kind === 'test';
  const buttonLabel = practice ? '我已了解，开始试玩' : '我已了解，开始正式实验';
  root.innerHTML = `<section class="block-gate ${practice ? 'block-gate-practice' : 'block-gate-formal'}" role="dialog" aria-modal="true" aria-labelledby="block-gate-title" aria-describedby="block-gate-rule block-gate-detail">
    <div class="block-gate-brand"><span class="brand-mark">p.</span><span>PREDICTION LAB</span></div>
    <div class="block-gate-content">
      <p class="block-gate-kicker">${practice ? '熟悉任务 · PRACTICE' : '准备开始 · EXPERIMENT'}</p>
      <div class="block-gate-emblem" aria-hidden="true">${practice ? '◎' : '◇'}</div>
      <h1 id="block-gate-title" tabindex="-1">${practice ? '接下来是试玩环节' : '接下来是正式实验'}</h1>
      <p class="block-gate-rule" id="block-gate-rule">${block.scores_excluded_from_formal ? '本环节不计入正式成绩' : '本环节计入正式成绩'}</p>
      <p class="block-gate-detail" id="block-gate-detail"></p>
      <p class="block-gate-rounds">共 <strong>${block.total_trials}</strong> 轮<span>按你的节奏完成</span></p>
      <button class="block-gate-start" id="block-continue">${buttonLabel}<span aria-hidden="true">→</span></button>
      <p class="block-gate-error" role="alert"></p>
    </div>
    <p class="block-gate-footer">阅读说明后，点击按钮进入${practice ? '试玩' : '正式实验'}。</p>
  </section>`;
  requireElement(root, '#block-gate-detail').textContent = block.intro_notice;
  window.scrollTo(0, 0);
  requireElement<HTMLElement>(root, '#block-gate-title').focus({ preventScroll: true });
  const button = requireElement<HTMLButtonElement>(root, '#block-continue');
  button.onclick = () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在进入…';
    requireElement(root, '.block-gate-error').textContent = '';
    void Promise.resolve()
      .then(options.onContinue)
      .catch((error: unknown) => {
        button.disabled = false;
        button.textContent = buttonLabel;
        requireElement(root, '.block-gate-error').textContent =
          error instanceof Error ? error.message : '暂时无法进入，请重试。';
      });
  };
}
