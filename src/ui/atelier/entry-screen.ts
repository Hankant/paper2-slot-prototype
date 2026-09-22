import type { DeviceClass, ParticipationMode } from '@contracts';
import { ENTRY_MATERIAL, type EntryAcknowledgement } from '../../domain/entry-materials.js';
import type { EntryMaterialShape } from '../../domain/collection-materials.js';
import { requireElement } from './dom.js';
import { symbol } from './symbols.js';

export interface EntryScreenOptions {
  /** Consent/instructions copy override (collection mode). Default: preview material. */
  readonly material?: EntryMaterialShape;
  /** Header badge text. Default: 单轮体验. */
  readonly badge?: string;
  readonly footerLeft?: string;
  readonly footerRight?: string;
  /** Show the entry-code + participation-mode step before consent. */
  readonly credential?: {
    readonly onSubmit?: (credential: {
      entry_code: string;
      participation_mode: ParticipationMode;
    }) => void;
  };
  /** Device detected by the caller (shown read-only; never asked here). */
  readonly detectedDeviceClass?: DeviceClass;
}

/** No experiment session is opened until both entry steps have been completed. */
export function mountEntry(
  onStart: (entry: EntryAcknowledgement) => Promise<void>,
  options: EntryScreenOptions = {},
): void {
  const material = options.material ?? ENTRY_MATERIAL;
  const badge = options.badge ?? '单轮体验';
  const footerLeft = options.footerLeft ?? '预测任务 · 本地交互原型';
  const footerRight = options.footerRight ?? '参与说明草稿 / 非正式招募';
  const deviceLabel: Record<DeviceClass, string> = {
    mobile: '手机',
    desktop: '电脑',
    tablet: '平板',
    unknown: '未识别',
  };
  const root = requireElement<HTMLElement>(document, '#paper2-immersive-root');
  let acceptedAt: string | null = null;
  let busy = false;
  let credential: { entry_code: string; participation_mode: ParticipationMode } | null = null;
  const get = <T extends HTMLElement>(selector: string): T => requireElement<T>(root, selector);

  function shell(step: 'access' | 'consent' | 'instructions' | 'exit', content: string): void {
    const accessNav =
      options.credential === undefined
        ? ''
        : `<span ${step === 'access' ? 'aria-current="step"' : ''}><b>00</b>参与码</span><i></i>`;
    root.innerHTML = `<div class="experience entry-experience">
      <header class="topbar"><span class="wordmark"><span class="brand-mark">p.</span>PREDICTION LAB</span><span class="entry-badge">${badge}</span></header>
      <main class="entry-main"><nav class="entry-progress" aria-label="开始前的步骤">${accessNav}<span ${step === 'consent' ? 'aria-current="step"' : ''}><b>01</b>知情同意</span><i></i><span ${step === 'instructions' ? 'aria-current="step"' : ''}><b>02</b>操作说明</span><i></i><span><b>03</b>开始实验</span></nav>${content}</main>
      <footer class="experience-footer"><span>${footerLeft}</span><span>${footerRight}</span></footer></div>`;
    window.scrollTo(0, 0);
    get<HTMLHeadingElement>('h1').focus({ preventScroll: true });
  }

  function credentialStep(): void {
    shell(
      'access',
      `<div class="instructions-heading"><p class="eyebrow">参与码 / ACCESS</p><h1 tabindex="-1">输入参与码，选择参与方式。</h1><p class="entry-lead">参与码由研究组织提供；参与方式与设备类型会分别记录。</p></div>
      <section class="consent-card" aria-labelledby="access-title"><h2 id="access-title" class="eyebrow">访问信息</h2>
      <fieldset class="credential-fields"><label for="entry-code">参与码</label><input id="entry-code" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="例如 COLLECT-2026" minlength="8" required>
      <legend>参与方式</legend><div class="mode-options"><label><input type="radio" name="participation-mode" value="on_site" checked><span>现场参与<small>在研究现场扫码或登记进入</small></span></label><label><input type="radio" name="participation-mode" value="remote"><span>远程参与<small>通过链接在自有设备上完成</small></span></label></div>
      <p class="device-note">检测到的设备类型：<b>${deviceLabel[options.detectedDeviceClass ?? 'unknown']}</b>（按浏览器信息自动识别，单独记录）</p></fieldset>
      <div class="entry-actions"><button class="primary" id="credential-next" disabled>继续阅读知情同意 <span>→</span></button></div><p class="entry-error" role="alert"></p></section>`,
    );
    const input = get<HTMLInputElement>('#entry-code');
    const next = get<HTMLButtonElement>('#credential-next');
    input.oninput = () => {
      get('.entry-error').textContent = '';
      next.disabled = input.value.trim().length < 8;
    };
    next.onclick = () => {
      const mode = root.querySelector<HTMLInputElement>('input[name="participation-mode"]:checked');
      credential = {
        entry_code: input.value.trim(),
        participation_mode: (mode?.value === 'remote' ? 'remote' : 'on_site') as ParticipationMode,
      };
      options.credential?.onSubmit?.(credential);
      consent();
    };
  }

  function consent(): void {
    acceptedAt = null;
    shell(
      'consent',
      `<div class="entry-layout"><aside class="entry-overview"><p class="eyebrow">开始之前 / WELCOME</p><h1 tabindex="-1">欢迎参加<br>预测实验。</h1><p class="entry-lead">观察历史信息，做出你的判断。<br>开始前，请先了解参与内容。</p>
      <div class="entry-illustration" aria-hidden="true"><span>PREDICTION LAB / 01</span><div>${['cherry', 'lemon', 'bell'].map((s) => `<i>${symbol(s)}</i>`).join('')}</div><b>观察 · 判断 · 选择</b></div>
      <dl class="entry-facts"><div><dt>本次内容</dt><dd>试玩与预测任务</dd></div><div><dt>参与设备</dt><dd>手机或电脑浏览器</dd></div><div><dt>开始方式</dt><dd>阅读并自愿确认</dd></div></dl>
      <p class="entry-side-note">请在方便、安静的环境中操作。你可以按自己的节奏阅读，也可以选择不参加。</p></aside>
      <section class="consent-card" aria-labelledby="consent-title"><div class="entry-card-heading"><span class="eyebrow">PARTICIPATION INFORMATION</span><span class="draft-pill">演示草稿</span></div><h2 id="consent-title">${material.title}</h2>
      <div class="consent-sections">${material.sections.map((s, i) => `<section><h3><span>${String(i + 1).padStart(2, '0')}</span>${s.title}</h3><p>${s.text}</p></section>`).join('')}</div>
      <details class="entry-pending"><summary>正式版本尚需确认的信息</summary><p>${material.pending}</p></details>
      <fieldset class="consent-checks"><legend>你的参与决定</legend>${material.checks.map((text, i) => `<label><input type="checkbox" id="consent-check-${i}"><span>${text}</span></label>`).join('')}</fieldset>
      <div class="entry-actions"><button class="entry-secondary" id="decline">不同意并退出</button><button class="primary" id="accept" disabled>同意并查看操作说明 <span>→</span></button></div><p class="entry-fine-print">请自行勾选确认；不勾选不会开始实验。</p></section></div>`,
    );
    const accept = get<HTMLButtonElement>('#accept');
    root.querySelectorAll<HTMLInputElement>('.consent-checks input').forEach((input) => {
      input.onchange = () => {
        accept.disabled = !Array.from(
          root.querySelectorAll<HTMLInputElement>('.consent-checks input'),
        ).every((c) => c.checked);
      };
    });
    accept.onclick = () => {
      if (accept.disabled) return;
      acceptedAt = new Date().toISOString();
      instructions();
    };
    get<HTMLButtonElement>('#decline').onclick = declined;
  }

  function instructions(): void {
    shell(
      'instructions',
      `<div class="instructions-heading"><p class="eyebrow">操作说明 / HOW IT WORKS</p><h1 tabindex="-1">一次预测，分三步完成。</h1><p class="entry-lead">先形成自己的判断，再决定是否参考建议。最终答案始终由你确认。</p></div>
      <div class="instruction-cards">${material.steps.map((s, i) => `<section><span class="instruction-number">0${i + 1}</span><h2>${s.title}</h2><p>${s.text}</p><span class="instruction-caption">${['选择机器 + 报告信心', '依据自己 / 参考 AI', '锁定答案 + 拉杆开奖'][i]}</span></section>`).join('')}</div>
      <div class="instruction-notes"><section><span class="note-mark">!</span><div><h2>预测的是“本轮实际中奖”</h2><p>历史命中率仅供参考。历史表现最好的一台，这一轮也可能没有中奖；系统按本轮实际结果计分。</p></div></section><section><span class="note-mark">↗</span><div><h2>开始后怎样操作</h2><p>点击机柜下方的选择按钮。AI 回答支持停止和继续；选择 AI 时，读完本轮建议后才能确认最终预测。完成后可以下载本轮记录。</p></div></section></div>
      <div class="entry-start-bar"><div><span class="entry-ready-dot"></span><span>已确认参与说明 · 准备就绪后开始</span></div><div class="entry-actions"><button class="entry-secondary" id="back">返回修改参与决定</button><button class="primary" id="start">开始实验 <span>→</span></button></div></div><p class="entry-error" role="alert"></p>`,
    );
    get<HTMLButtonElement>('#back').onclick = () => {
      if (!busy) consent();
    };
    get<HTMLButtonElement>('#start').onclick = async () => {
      if (busy || !acceptedAt) return;
      busy = true;
      get<HTMLButtonElement>('#start').disabled = true;
      get<HTMLButtonElement>('#back').disabled = true;
      get('#start').textContent = '正在进入…';
      get('.entry-error').textContent = '';
      try {
        await onStart({
          consent_version: material.consentVersion,
          instructions_version: material.instructionsVersion,
          accepted_at: acceptedAt,
          started_at: new Date().toISOString(),
          ...(credential === null
            ? {}
            : {
                entry_code: credential.entry_code,
                participation_mode: credential.participation_mode,
                device_class: options.detectedDeviceClass ?? 'unknown',
              }),
        } as EntryAcknowledgement);
      } catch (error) {
        get('.entry-error').textContent =
          error instanceof Error ? error.message : '暂时无法开始，请重试。';
        get<HTMLButtonElement>('#start').disabled = false;
        get<HTMLButtonElement>('#back').disabled = false;
        get('#start').textContent = '重试进入实验';
      } finally {
        busy = false;
      }
    };
  }

  function declined(): void {
    acceptedAt = null;
    shell(
      'exit',
      `<section class="entry-exit"><span class="exit-symbol">↗</span><p class="eyebrow">参与由你决定</p><h1 tabindex="-1">已退出本次体验。</h1><p>你没有开始实验，也没有生成作答记录。<br>现在可以关闭此页面。</p><button class="entry-secondary" id="return">返回参与说明</button></section>`,
    );
    get<HTMLButtonElement>('#return').onclick = () =>
      options.credential === undefined ? consent() : credentialStep();
  }

  if (options.credential === undefined) consent();
  else credentialStep();
}
