/**
 * Entry copy for the server-backed collection pilot.
 *
 * Unlike the memory-only preview material, this copy explicitly describes
 * server storage and restart recovery. It is injected into mountEntry via
 * options; the preview default (ENTRY_MATERIAL) is unchanged.
 */

import type { EntryAcknowledgement } from './entry-materials.js';

export interface EntryMaterialShape {
  readonly consentVersion: string;
  readonly instructionsVersion: string;
  readonly title: string;
  readonly status: string;
  readonly sections: ReadonlyArray<{ readonly title: string; readonly text: string }>;
  readonly pending: string;
  readonly checks: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<{ readonly title: string; readonly text: string }>;
}

export const COLLECTION_MATERIAL: EntryMaterialShape = {
  consentVersion: 'collect-consent-2026-09-22-v2',
  instructionsVersion: 'collect-instructions-2026-09-22-v2',
  title: '预测任务参与知情同意书',
  status: '研究试运行',
  sections: [
    {
      title: '参与内容',
      text: '本任务关注人们如何根据历史信息和 AI 助手建议做出预测。你将先完成试玩，再从三台机器中预测本轮实际中奖的一台，报告信心，并在查看参考建议后确认最终答案。每轮只有一台机器中奖。',
    },
    {
      title: '自愿参与与退出',
      text: '是否参与由你决定。你可以在过程中随时关闭页面；已完成并保存的步骤会保留，在同一浏览器会话中刷新可从已保存位置继续，也可以选择不再继续。退出不会删除已保存的记录。',
    },
    {
      title: '记录哪些信息',
      text: '系统分配匿名参与者编号（不含姓名，不保存参与码），并记录参与方式、设备类型、同意版本、试玩选择、正式选择、信心、作答时间、助手对话、页面呈现、积分与结果。请勿在对话中输入姓名、电话或其他个人资料。',
    },
    {
      title: '记录如何保存',
      text: '你的作答与对话记录保存在本试点的研究服务器数据库中（非当前页面内存）。每次保存以服务器回执为准；在同一浏览器会话与标签页中刷新时，已确认的作答会从服务器恢复，未确认的作答会以相同记录 ID 自动重试。完成后可下载本人记录。服务器重启后已确认记录仍保留。关闭标签页可能丢失尚未确认的缓存；清除 Cookie 或更换浏览器后暂不能自行找回会话。',
    },
    {
      title: '体验与报酬',
      text: '任务可能带来短暂的犹豫或答错后的挫败感，不适时可停止。预测正确将获得积分；总积分用于计算任务奖励，具体兑换规则以研究现场说明为准。',
    },
    {
      title: 'AI 助手',
      text: '任务过程中可查看 AI 助手给出的本轮建议。建议会以对话方式逐步显示；你可以保留自己的判断，也可以据此调整最终预测。',
    },
  ],
  pending:
    '正式参与资格、预计时长、报酬、研究负责人及联系方式、伦理审批信息、数据保存期限与撤回办法尚待确认。正式招募前须替换为研究团队确认的完整文本。',
  checks: [
    '我已阅读上述说明，理解参与自愿，可以停止体验。',
    '我理解作答记录会保存到研究服务器，刷新后可从已保存位置继续。',
    '我理解任务包含 AI 助手建议、积分记录与结果反馈，并自愿继续参与。',
  ],
  steps: [
    {
      title: '先独立预测',
      text: '先完成三轮试玩，熟悉“近期开奖占比”、来源命中率和积分规则。正式任务中选择你预测会中奖的机器，并报告 0—100 的预测信心。确认并收到服务器回执后，独立答案锁定。',
    },
    {
      title: '选择参考来源',
      text: '选择依据自己判断，或参考 AI 建议。选择 AI 后，在对话中发送“本轮预测”，读完建议后返回。你可以保留原判断，也可以改变最终答案。',
    },
    {
      title: '确认并开奖',
      text: '重新选择并锁定最终预测，再点击拉杆开奖。本任务每轮只有一台机器中奖，最终预测与实际中奖机器相同得 10 积分，否则为 0。完成后可以下载本人记录。',
    },
  ],
};

/** Entry acknowledgement extended with the collect-mode credential probes. */
export interface CollectionEntryAcknowledgement extends EntryAcknowledgement {
  entry_code: string;
  participation_mode: 'on_site' | 'remote';
  device_class: 'mobile' | 'desktop' | 'tablet' | 'unknown';
}
