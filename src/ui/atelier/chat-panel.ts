import { CLIENT_VERSION, CONTRACT_VERSION, type ChatRequest, type ChatService } from '@contracts';
import { readChatStream } from '../../experiment/chat-stream-reader.js';
import { type ImmersiveRun } from '../../experiment/immersive-run.js';
import { STANDARD_QUESTION, FOLLOWUP_QUESTION } from '../../domain/chat-materials.js';
import { arrow, spark } from './symbols.js';
import { requireElement } from './dom.js';

interface Message {
  request: ChatRequest;
  text: string;
  completed: boolean;
  node: HTMLElement;
}
export class ChatPanel {
  readonly dialog: HTMLDialogElement;
  private messages: Message[] = [];
  private active: AbortController | null = null;
  private interrupted: Message | null = null;
  private input: HTMLTextAreaElement;
  private status: HTMLElement;
  private body: HTMLElement;
  private finish: HTMLButtonElement;
  private send: HTMLButtonElement;
  private resume: HTMLButtonElement;
  private readonly onVisibility = (): void => {
    if (document.hidden) this.active?.abort();
  };
  constructor(
    private run: ImmersiveRun,
    private service: ChatService,
    onFinish: () => void,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'assistant-dialog';
    this.dialog.setAttribute('aria-label', '研究助手对话');
    this.dialog.innerHTML = `<div class="chat-shell">
      <header class="chat-header"><div class="assistant-brand">${spark}<div>研究助手<small>本轮独立会话</small></div></div><button class="chat-close" aria-label="收起对话">✕</button></header>
      <div class="chat-context"><span>第 01 轮</span><span>你的独立预测 <b>机器 ${run.independent}</b></span><span class="script-label">模拟助手</span></div>
      <div class="conversation"><div class="chat-welcome">${spark}<h2>一起看看这一轮。</h2><p>向助手请求建议，再由你确认最终预测。</p></div><div class="messages"></div></div>
      <button class="scroll-latest" hidden>回到最新消息 ↓</button>
      <div class="chat-controls"><p class="chat-status" role="status"></p><button class="resume-chat" hidden>继续读取同一回答</button>
      <div class="question-chips"><button data-question="prediction">本轮预测</button><button data-question="explain">如何使用建议</button></div>
      <div class="composer"><textarea rows="2" aria-label="给研究助手发消息" maxlength="2000"></textarea><button class="send-chat" aria-label="发送消息">${arrow}</button></div>
      <p class="chat-disclosure">固定材料演示 · 支持上方标准问题 · 未连接真实模型</p>
      <button class="primary finish-chat" disabled>返回并确认最终预测 <span>↗</span></button></div></div>`;
    document.body.append(this.dialog);
    this.input = this.get('textarea');
    this.input.value = STANDARD_QUESTION;
    this.status = this.get('.chat-status');
    this.body = this.get('.conversation');
    this.finish = this.get('.finish-chat');
    this.send = this.get('.send-chat');
    this.resume = this.get('.resume-chat');
    this.get<HTMLButtonElement>('.chat-close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => {
      this.active?.abort();
      this.run.note('chat_closed');
    });
    this.dialog.addEventListener('cancel', () => this.active?.abort());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.finish.onclick = () => {
      if (!this.active && run.chatCompleted) {
        run.finishChat();
        this.dialog.close();
        onFinish();
      }
    };
    this.send.onclick = () => {
      if (this.active) this.active.abort();
      else void this.submit();
    };
    this.input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!this.active) void this.submit();
      }
    };
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((b) => {
      b.onclick = () => {
        if (!this.active) {
          this.input.value =
            b.dataset.question === 'prediction' ? STANDARD_QUESTION : FOLLOWUP_QUESTION;
          this.input.focus();
        }
      };
    });
    this.resume.onclick = () => {
      if (this.interrupted && !this.active) void this.play(this.interrupted);
    };
    const latest = this.get<HTMLButtonElement>('.scroll-latest');
    latest.onclick = () => {
      this.body.scrollTop = this.body.scrollHeight;
    };
    this.body.onscroll = () => {
      latest.hidden = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 70;
    };
  }
  private get<T extends HTMLElement>(selector: string): T {
    return requireElement<T>(this.dialog, selector);
  }
  open(): void {
    this.dialog.showModal();
    this.run.note('chat_opened');
  }
  dispose(): void {
    this.active?.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.dialog.remove();
  }
  private controls(): void {
    this.send.innerHTML = this.active ? '<span class="stop-square"></span>' : arrow;
    this.send.setAttribute('aria-label', this.active ? '停止回答' : '发送消息');
    this.input.disabled = this.active !== null;
    this.finish.disabled =
      this.active !== null || !this.run.chatCompleted || this.interrupted !== null;
    this.resume.hidden = this.active !== null || this.interrupted === null;
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((b) => {
      b.disabled = this.active !== null || this.interrupted !== null;
    });
  }
  private async submit(): Promise<void> {
    if (this.active || !this.input.value.trim()) return;
    if (this.interrupted) {
      this.status.textContent = '请先继续读取当前回答。';
      return;
    }
    const text = this.input.value.trim();
    if (!this.run.advice) {
      this.status.textContent = '本阶段没有可用建议';
      return;
    }
    const request: ChatRequest = {
      session_id: this.run.session.session_id,
      trial_id: this.run.trialId,
      advice_id: this.run.advice.advice_id,
      request_id: crypto.randomUUID(),
      user_text: text,
      user_text_chars: text.length,
      source_choice: 'ai',
      locale: 'zh-CN',
      client_versions: {
        contract_version: CONTRACT_VERSION,
        client_version: CLIENT_VERSION,
        material_version: this.run.session.material_version,
        protocol_version: this.run.session.protocol_version,
      },
    };
    this.get('.chat-welcome').hidden = true;
    const user = document.createElement('div');
    user.className = 'user-message';
    user.textContent = text;
    const answer = document.createElement('div');
    answer.className = 'assistant-message';
    answer.innerHTML = `<div class="message-avatar">${spark}</div><div class="answer-copy"><p class="answer-text"></p></div>`;
    this.get('.messages').append(user, answer);
    const message: Message = {
      request,
      text: '',
      completed: false,
      node: requireElement(answer, '.answer-text'),
    };
    this.messages.push(message);
    this.input.value = '';
    this.body.scrollTop = this.body.scrollHeight;
    await this.play(message);
  }
  private async play(message: Message): Promise<void> {
    this.active = new AbortController();
    this.interrupted = null;
    this.status.textContent = '正在生成回答…';
    this.controls();
    let accumulated = '';
    let completed = false;
    this.run.note('chat_requested', message.request);
    message.node.classList.add('typing');
    try {
      for await (const event of readChatStream(
        this.service.streamReply(message.request, this.active.signal),
        message.request.request_id,
      )) {
        this.run.note('chat_stream_event', event);
        if (event.type === 'text_delta') {
          accumulated += event.text;
          if (accumulated.length > message.text.length) {
            const follow =
              this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 80;
            message.text = accumulated;
            message.node.textContent = accumulated;
            if (follow) this.body.scrollTop = this.body.scrollHeight;
            this.run.note('chat_fragment_rendered', {
              request_id: message.request.request_id,
              sequence: event.sequence,
              text: event.text,
              dialog_open: this.dialog.open,
              document_visible: !document.hidden,
            });
          }
        }
        if (event.type === 'completed') completed = true;
        if (event.type === 'failed') throw new Error(event.error_message);
      }
      // A browser paint separates text delivery from making the final action available.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      // Hidden or closed conversations cannot count as completed presentation.
      completed = completed && this.dialog.open && !document.hidden;
      message.completed = completed;
      if (completed) {
        if (message.request.user_text === STANDARD_QUESTION) {
          await this.run.markAdvicePresented();
          this.run.chatCompleted = true;
        }
        this.run.note('chat_display_completed', {
          request_id: message.request.request_id,
          text: message.text,
        });
        this.status.textContent = this.run.chatCompleted
          ? '回答完成。你可以继续提问，或返回确认预测。'
          : '请选择“本轮预测”，获取本轮建议。';
        if (!message.node.parentElement?.querySelector('.copy-message')) {
          const copy = document.createElement('button');
          copy.className = 'copy-message';
          copy.textContent = '复制回答';
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(message.text);
              copy.textContent = '已复制';
            } catch {
              this.status.textContent = '无法访问剪贴板，请选择文字复制。';
            }
          };
          message.node.parentElement?.append(copy);
        }
      } else {
        this.interrupted = message;
        this.status.textContent = '已停止。已显示的内容保留，可继续读取同一回答。';
      }
    } catch (error) {
      this.interrupted = message;
      this.status.textContent = error instanceof Error ? error.message : '回答暂时不可用';
      this.run.note('chat_failed', this.status.textContent);
    } finally {
      message.node.classList.remove('typing');
      this.active = null;
      this.controls();
    }
  }
}
