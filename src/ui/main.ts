/**
 * G0 demo entry. Mounts a SIMULATION banner and a status panel reading the
 * boot-time constants. No jsPsych timeline is wired here — that is agent B's
 * responsibility in G1.
 */

import {
  BOOT_CLIENT_VERSION,
  BOOT_CONTRACT_VERSION,
  BOOT_PROTOCOL_VERSION,
  DEMO_BANNER_TEXT,
  demoConfiguration,
  reportBootstrap,
} from '../bootstrap.js';

const root: HTMLElement | null = document.getElementById('paper2-root');
if (root === null) {
  throw new Error('paper2-root element missing in index.html');
}

const banner = document.createElement('div');
banner.dataset.simulationBanner = 'true';
banner.textContent = DEMO_BANNER_TEXT;
banner.className = 'paper2-sim-banner';

const report = reportBootstrap();

const status = document.createElement('pre');
status.dataset.bootstrapReport = 'true';
status.className = 'paper2-status';
status.textContent = JSON.stringify(
  {
    banner: report.simulation ? 'SIMULATION' : 'PRODUCTION',
    contract_version: BOOT_CONTRACT_VERSION,
    protocol_version: BOOT_PROTOCOL_VERSION,
    client_version: BOOT_CLIENT_VERSION,
    demo_config_version: demoConfiguration.configVersion,
    demo_provider: demoConfiguration.provider,
    task_definition: demoConfiguration.taskDefinition,
    advice_timing: demoConfiguration.adviceTiming,
    feedback_mode: demoConfiguration.feedbackMode,
    adapter_wired: report.adapter_wired,
    research_decisions_tbd: demoConfiguration.researchDecisionsThatRemainTbd,
  },
  null,
  2,
);

const phaseList = document.createElement('ul');
phaseList.dataset.phaseList = 'true';
phaseList.className = 'paper2-phase-list';
for (const phase of demoConfiguration.phaseOrder) {
  const item = document.createElement('li');
  item.textContent = phase;
  phaseList.appendChild(item);
}

const explanation = document.createElement('p');
explanation.className = 'paper2-explanation';
explanation.textContent =
  '本页面属于 G0 公共基础验收。它只装配合同版本与 demo 配置；' +
  '尚未连线真实适配器、未启动 jsPsych 时间线，不构成研究收集入口。' +
  '真实预测、来源选择、积分与持久化保存分别属于 B、C、D 模块的实施范围。';

root.appendChild(banner);
const previewLink = document.createElement('a');
previewLink.href = './preview.html';
previewLink.textContent = '打开一题可点击模拟预览 →';
previewLink.className = 'paper2-explanation';
root.appendChild(previewLink);
root.appendChild(status);
root.appendChild(phaseList);
root.appendChild(explanation);

console.warn('paper2 prototype g0 mount', report);
