import { requireElement } from './ui/atelier/dom.js';
import './ui/admin.css';
import { adminConfigSchema, conditionSchema, type AdminConfig } from './domain/admin-config.js';
import { createExperimentPlan } from './domain/experiment-plan.js';
import { randomId } from './uuid.js';

type Catalog = { id: string; title: string; position: 'pre' | 'post'; instrument_version: string };
type ConfigResponse = { revision: number; config: AdminConfig; questionnaire_blocks: Catalog[] };
type Summary = {
  session_id: string;
  condition_id: string;
  configuration_revision: number;
  completed: boolean;
  completed_trials: number;
  total_trials: number;
  completed_modules: number;
  total_modules: number;
  formal_points: number;
  reward_cny: number | null;
  reward_code: string | null;
  issues: string[];
  created_at: string;
  updated_at: string;
};
const root = requireElement<HTMLDivElement>(document, '#admin');
let token = '';
let current: ConfigResponse;
let sessions: Summary[] = [];
const esc = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status}：${message}`);
  }
  return (await response.json()) as T;
}
function notice(message: string, error = false) {
  const el = requireElement<HTMLElement>(root, '#notice');
  el.textContent = message;
  el.classList.toggle('error', error);
}
function login() {
  token = '';
  sessions = [];
  root.innerHTML =
    '<main><section class="login"><div class="eyebrow">PAPER 2 / RESEARCH CONSOLE</div><h1>实验控制台</h1><p>配置实验流程，查看采集进度与导出数据。</p><form id="login"><label>管理员密钥<input name="token" type="password" autocomplete="off" required></label><div class="toolbar"><button class="primary">进入控制台</button></div></form><p class="hint">密钥只保留在本页内存中，刷新后需要重新输入。请在采集服务器的地址下使用此页面。</p><div id="notice" class="notice" role="status"></div></section></main>';
  requireElement(root, 'form').addEventListener('submit', async (e) => {
    e.preventDefault();
    token = (new FormData(e.target as HTMLFormElement).get('token') as string).trim();
    try {
      current = await request<ConfigResponse>('/api/admin/config');
      render();
      await refresh();
    } catch (error) {
      token = '';
      notice(String(error), true);
    }
  });
}
function normalize() {
  let index = 0;
  for (const module of current.config.plan.modules)
    if (module.kind === 'trials') module.block.block_index = index++;
}
function render() {
  root.innerHTML = `<main><header><div><div class="eyebrow">PAPER 2 / RESEARCH CONSOLE</div><h1>实验控制台</h1><p>配置仅应用于新会话；已经进入实验的参与者保留原配置。</p></div><button id="logout">退出</button></header><div id="notice" class="notice" role="status"></div><section><h2>01 实验流程 <span class="badge" id="revision">版本 ${current.revision}</span></h2><label>配置名称<input id="config-name" value="${esc(current.config.name)}" maxlength="100"></label><div id="flow"></div><div class="toolbar"><select id="add-kind" aria-label="添加模块"><option value="test">试玩任务</option><option value="formal">正式任务</option>${current.questionnaire_blocks.map((b) => `<option value="q:${esc(b.id)}">问卷：${esc(b.title)}</option>`).join('')}</select><button id="add-module">添加模块</button></div></section><section><h2>02 条件与奖励</h2><p class="hint">多个条件时，新会话以相同概率随机分配，条件与配置版本一并存档。短区块的 AI 实际命中比例会按轮数取整。金额留空表示尚未设置兑换比例。</p><div class="scroll"><table><thead><tr><th>条件 ID</th><th>AI 档位名称</th><th>人类平均命中率 %</th><th>AI 命中率 %</th><th>答对积分</th><th>元 / 分</th><th></th></tr></thead><tbody id="conditions"></tbody></table></div><div class="toolbar"><button id="add-condition">添加条件</button><button id="save" class="primary">发布配置（仅新会话）</button><button id="reload">重新读取已发布配置</button></div></section><section><h2>03 采集记录</h2><div id="metrics" class="metrics"></div><div class="toolbar"><label>搜索会话或条件<input id="search" placeholder="会话 ID / 条件 ID"></label><label>状态<select id="status"><option value="all">全部</option><option value="done">已完成</option><option value="active">未完成</option><option value="issues">待核查</option></select></label><button id="refresh">刷新进度</button><button id="json">导出筛选 JSON</button><button id="csv">导出筛选 CSV</button></div><p class="hint">待核查只作提示，不自动剔除。兑换码用于人工核对，系统不会自动付款。问卷草稿仅保存在参与者浏览器，提交后才计入这里。</p><div class="scroll"><table><thead><tr><th>会话 / 版本</th><th>条件</th><th>进度</th><th>正式积分 / 奖励</th><th>兑换码</th><th>待核查</th></tr></thead><tbody id="sessions"></tbody></table></div></section></main>`;
  requireElement(root, '#logout').addEventListener('click', login);
  requireElement<HTMLInputElement>(root, '#config-name').addEventListener(
    'input',
    (e) => (current.config.name = (e.target as HTMLInputElement).value),
  );
  renderFlow();
  renderConditions();
  requireElement(root, '#add-module').addEventListener('click', () => {
    const kind = requireElement<HTMLSelectElement>(root, '#add-kind').value;
    if (kind.startsWith('q:')) {
      const q = current.questionnaire_blocks.find((b) => b.id === kind.slice(2));
      if (!q) return;
      current.config.plan.modules.push({
        kind: 'questionnaire',
        module_id: `q-${randomId()}`,
        block_ids: [q.id],
        position: q.position,
        instrument_version: q.instrument_version,
      });
    } else {
      const sample = createExperimentPlan().modules.find(
        (m) => m.kind === 'trials' && m.block.block_kind === kind,
      );
      if (!sample) return;
      if (sample.kind === 'trials') {
        sample.block.block_id = `${kind}-${randomId()}`;
        current.config.plan.modules.push(sample);
      }
    }
    normalize();
    renderFlow();
  });
  requireElement(root, '#add-condition').addEventListener('click', () => {
    current.config.conditions.push({
      ...conditionSchema.parse(current.config.conditions[0]),
      condition_id: `condition-${current.config.conditions.length + 1}`,
    });
    renderConditions();
  });
  requireElement(root, '#save').addEventListener('click', async (e) => {
    const button = e.target as HTMLButtonElement;
    button.disabled = true;
    try {
      normalize();
      const parsed = adminConfigSchema.safeParse(current.config);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'),
        );
      current = await request<ConfigResponse>('/api/admin/config', {
        expected_revision: current.revision,
        config: parsed.data,
      });
      requireElement(root, '#revision').textContent = `版本 ${current.revision}`;
      notice('已发布。新进入的会话使用此配置，已有会话不变。');
    } catch (error) {
      notice(String(error), true);
    } finally {
      button.disabled = false;
    }
  });
  requireElement(root, '#reload').addEventListener('click', async () => {
    try {
      current = await request<ConfigResponse>('/api/admin/config');
      render();
      renderSessions();
      notice('已读取发布版本。');
    } catch (error) {
      notice(String(error), true);
    }
  });
  requireElement(root, '#refresh').addEventListener('click', () => void refresh());
  for (const id of ['search', 'status'])
    requireElement(root, `#${id}`).addEventListener('input', renderSessions);
  for (const format of ['json', 'csv'])
    requireElement(root, `#${format}`).addEventListener('click', () => void download(format));
}
function renderFlow() {
  const holder = requireElement(root, '#flow');
  holder.innerHTML = current.config.plan.modules
    .map(
      (m, i) =>
        `<div class="flow-row"><span class="badge ${m.kind === 'trials' && m.block.block_kind === 'test' ? 'practice' : ''}">${i + 1}</span><div class="description"><strong>${m.kind === 'trials' ? esc(m.block.display_label) : '问卷：' + m.block_ids.map((id) => esc(current.questionnaire_blocks.find((q) => q.id === id)?.title ?? id)).join('、')}</strong><small>${m.kind === 'trials' ? (m.block.block_kind === 'test' ? '持续显示试玩标识 · 不显示积分 · 不计奖励' : '正式成绩计入奖励') : esc(m.position) + ' · ' + esc(m.instrument_version)}</small></div>${m.kind === 'trials' ? `<label>轮数<input data-round="${i}" type="number" min="1" max="500" value="${m.block.total_trials}"></label>` : ''}<div class="actions"><button data-move="${i}" data-delta="-1" aria-label="上移模块 ${i + 1}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-move="${i}" data-delta="1" aria-label="下移模块 ${i + 1}" ${i === current.config.plan.modules.length - 1 ? 'disabled' : ''}>↓</button><button data-remove="${i}" aria-label="删除模块 ${i + 1}">移除</button></div></div>`,
    )
    .join('');
  holder.querySelectorAll<HTMLInputElement>('[data-round]').forEach((input) =>
    input.addEventListener('input', () => {
      const m = current.config.plan.modules[Number(input.dataset.round)];
      if (!m) return;
      if (m.kind === 'trials') {
        m.block.total_trials = Number(input.value);
        m.block.intro_notice =
          m.block.block_kind === 'test'
            ? `共 ${input.value} 轮。试玩仅用于熟悉操作，不显示积分，不计入正式成绩或奖励。`
            : `共 ${input.value} 轮。每轮最终预测正确即可获得积分，正式积分用于奖励计算。`;
      }
    }),
  );
  holder.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) =>
    button.addEventListener('click', () => {
      const i = Number(button.dataset.move),
        j = i + Number(button.dataset.delta);
      const modules = current.config.plan.modules;
      const a = modules[i],
        b = modules[j];
      if (!a || !b) return;
      [modules[i], modules[j]] = [b, a];
      normalize();
      renderFlow();
    }),
  );
  holder.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) =>
    button.addEventListener('click', () => {
      current.config.plan.modules.splice(Number(button.dataset.remove), 1);
      normalize();
      renderFlow();
    }),
  );
}
function renderConditions() {
  const fields = [
    'condition_id',
    'ai_accuracy_tier',
    'human_average_hit_rate',
    'ai_hit_rate',
    'points_per_correct',
    'reward_per_point_cny',
  ] as const;
  const holder = requireElement(root, '#conditions');
  holder.innerHTML = current.config.conditions
    .map(
      (condition, i) =>
        `<tr>${fields.map((field) => `<td><input aria-label="${field} ${i + 1}" data-index="${i}" data-field="${field}" ${field === 'condition_id' || field === 'ai_accuracy_tier' ? 'type="text" maxlength="80"' : 'type="number" min="0" step="any"'} value="${esc(field.endsWith('hit_rate') ? Number((Number(condition[field]) * 100).toFixed(8)) : condition[field])}"></td>`).join('')}<td><button data-delete="${i}" ${current.config.conditions.length === 1 ? 'disabled' : ''}>移除</button></td></tr>`,
    )
    .join('');
  holder.querySelectorAll<HTMLInputElement>('input').forEach((input) =>
    input.addEventListener('input', () => {
      const condition = current.config.conditions[Number(input.dataset.index)],
        field = input.dataset.field as (typeof fields)[number];
      if (!condition) return;
      if (field === 'condition_id' || field === 'ai_accuracy_tier') condition[field] = input.value;
      else if (field === 'reward_per_point_cny')
        condition[field] = input.value === '' ? null : Number(input.value);
      else condition[field] = Number(input.value) / (field.endsWith('hit_rate') ? 100 : 1);
    }),
  );
  holder.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) =>
    button.addEventListener('click', () => {
      current.config.conditions.splice(Number(button.dataset.delete), 1);
      renderConditions();
    }),
  );
}
function filtered() {
  const search = requireElement<HTMLInputElement>(root, '#search').value.toLowerCase(),
    status = requireElement<HTMLSelectElement>(root, '#status').value;
  return sessions.filter(
    (s) =>
      (s.session_id + ' ' + s.condition_id).toLowerCase().includes(search) &&
      (status === 'all' ||
        (status === 'done' && s.completed) ||
        (status === 'active' && !s.completed) ||
        (status === 'issues' && s.issues.length > 0)),
  );
}
function renderSessions() {
  const shown = filtered();
  requireElement(root, '#metrics').innerHTML =
    `<span><b>${sessions.length}</b>全部会话</span><span><b>${sessions.filter((s) => s.completed).length}</b>已完成</span><span><b>${shown.length}</b>当前筛选</span>`;
  requireElement(root, '#sessions').innerHTML =
    shown
      .map(
        (s) =>
          `<tr><td class="session-id">${esc(s.session_id)}<br>配置 v${s.configuration_revision}</td><td>${esc(s.condition_id)}</td><td>${s.completed ? '已完成' : '进行中'}<br>任务 ${s.completed_trials}/${s.total_trials} · 模块 ${s.completed_modules}/${s.total_modules}</td><td>${s.formal_points} 分<br>${s.reward_cny === null ? '比例未设置' : '¥' + s.reward_cny.toFixed(2)}</td><td class="session-id">${esc(s.reward_code ?? '完成后生成')}</td><td class="issues">${s.issues.map(esc).join('<br>') || '—'}</td></tr>`,
      )
      .join('') || '<tr><td colspan="6">暂无符合条件的会话</td></tr>';
}
async function refresh() {
  try {
    sessions = (await request<{ sessions: Summary[] }>('/api/admin/sessions')).sessions;
    renderSessions();
    notice('进度已更新。');
  } catch (error) {
    notice(String(error), true);
  }
}
async function download(format: string) {
  try {
    const ids = filtered().map((s) => s.session_id);
    if (!ids.length) throw new Error('没有可导出的会话。');
    const response = await fetch(
      `/api/admin/export?format=${format}&session_ids=${encodeURIComponent(ids.join(','))}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(await response.text());
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement('a');
    link.href = url;
    link.download = `paper2-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(`已导出 ${ids.length} 个会话。`);
  } catch (error) {
    notice(String(error), true);
  }
}
login();
