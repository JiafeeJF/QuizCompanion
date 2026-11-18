import React from 'react';

/** Apple 风 AI 对话套件：iMessage 式气泡 + 呼吸输入中 + 胶囊输入条 */

export function ChatList({ children }) {
  return <div className="flex flex-col gap-2.5 px-4 py-4">{children}</div>;
}

export function BubbleUser({ children }) {
  return (
    <div className="flex justify-end">
      <div className="apple-bubble-user">{children}</div>
    </div>
  );
}

export function BubbleAI({ avatar = null, children }) {
  return (
    <div className="flex items-end justify-start gap-2">
      {avatar || (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">
          AI
        </span>
      )}
      <div className="apple-bubble-ai">{children}</div>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="apple-bubble-ai flex items-center gap-1.5 !py-3">
        <span className="wlbd-dot h-1.5 w-1.5 rounded-full bg-sub" />
        <span className="wlbd-dot wlbd-dot-2 h-1.5 w-1.5 rounded-full bg-sub" />
        <span className="wlbd-dot wlbd-dot-3 h-1.5 w-1.5 rounded-full bg-sub" />
      </div>
    </div>
  );
}

export function ChatInput({ value, onChange, onSend, placeholder = '输入消息…', disabled = false }) {
  return (
    <div className="apple-chat-input">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
      />
      <button
        onClick={onSend}
        disabled={disabled || !String(value || '').trim()}
        aria-label="发送"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-apple text-white transition active:scale-95 disabled:opacity-30"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
