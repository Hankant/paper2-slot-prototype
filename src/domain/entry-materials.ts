/** Draft copy for the local preview only; replace with approved study copy before recruitment. */
export const ENTRY_MATERIAL = {
  consentVersion: 'preview-consent-2026-09-18-v1',
  instructionsVersion: 'preview-instructions-2026-09-18-v1',
  title: '预测任务参与知情同意书',
  status: '演示草稿 · 非正式招募',
  sections: [
    {
      title: '参与内容',
      text: '本任务关注人们如何根据历史信息和参考建议做出预测。你将从三台机器中预测本轮实际中奖的一台，报告信心，选择参考来源，再确认最终答案。本页为单轮交互演示。',
    },
    {
      title: '自愿参与与退出',
      text: '是否体验由你决定。你可以选择不参加，也可以在过程中关闭页面。关闭或刷新会清空当前演示记录；你已下载的文件仍保留在自己的设备上。',
    },
    {
      title: '记录哪些信息',
      text: '本演示记录同意版本、选择、信心、作答时间、助手对话、页面呈现与结果，用于检查原型流程。请勿在对话中输入姓名、电话或其他个人资料。本页不要求填写身份信息。',
    },
    {
      title: '记录如何保存',
      text: '作答与对话记录仅保存在当前页面内存中，不上传到远程研究数据库。完成后可自行下载 JSON 记录；刷新后不能恢复。本说明仅适用于当前本地演示。',
    },
    {
      title: '体验与报酬',
      text: '任务可能带来短暂的犹豫或答错后的挫败感，不适时可停止。本演示不涉及真实投注或付款，积分仅用于展示，没有奖金兑换。',
    },
    {
      title: '助手与模拟材料',
      text: '助手使用预先编写的模拟建议，文字逐步显示，未调用真实 AI 模型。历史记录和开奖结果为演示材料，不代表真实预测能力。',
    },
  ],
  pending:
    '正式参与资格、预计时长、报酬、研究负责人及联系方式、伦理审批信息、数据保存期限与撤回办法尚待确认。正式招募前须替换为研究团队确认的完整文本。',
  checks: [
    '我已阅读上述说明，理解参与自愿，可以停止体验。',
    '我理解这是模拟演示，并自愿继续体验。',
  ],
  steps: [
    {
      title: '先独立预测',
      text: '查看 A、B、C 三台机器的历史命中率，选择你预测会中奖的机器，并报告 0—100 的预测信心。确认后，独立答案不能再修改。',
    },
    {
      title: '选择参考来源',
      text: '选择依据自己判断，或参考 AI 建议。选择 AI 后，在对话中发送“本轮预测”，读完建议后返回。你可以保留原判断，也可以改变最终答案。',
    },
    {
      title: '确认并开奖',
      text: '重新选择并锁定最终预测，再点击拉杆开奖。本演示每轮只有一台机器中奖，最终预测与实际中奖机器相同得 10 积分，否则为 0。',
    },
  ],
} as const;

export interface EntryAcknowledgement {
  consent_version: string;
  instructions_version: string;
  accepted_at: string;
  started_at: string;
}
