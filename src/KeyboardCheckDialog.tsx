import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  type KeyboardCheckSession,
  CHECK_DOTS,
  createSession,
  describeFailure,
  pressKey,
  reportBlur,
  startSession,
} from './keyboardCheck';

interface KeyboardCheckDialogProps {
  /** 仅在通过后由“返回校样台”触发；失败页不提供出口 */
  onClose: () => void;
}

/**
 * 六点键盘检查对话框。
 *
 * 挂载即开启一轮全新会话（点击校样台“开始按键检查”入口时挂载），
 * “重新检查”以 startSession 建立 id 递增的新会话，已确认记录不带入新一轮。
 *
 * 检查中在 window 捕获阶段拦截按键：先于抄录单元与输入框的处理器
 * stopPropagation + preventDefault，保证检查按键绝不改动明眼稿、
 * Cell 数组、点位串输入与当前判定；长按自动重复由领域层按 repeat 过滤。
 * 检查会话状态只存在于本组件，不进入抄录历史，也不触发草稿保存。
 */
export function KeyboardCheckDialog({ onClose }: KeyboardCheckDialogProps) {
  // 入口每次打开都挂载本组件：首轮即是全新会话
  const [session, setSession] = useState<KeyboardCheckSession>(() => startSession(createSession()));
  const panelRef = useRef<HTMLDivElement | null>(null);

  const checking = session.status === 'checking';

  // 检查中的按键在 window 捕获阶段统一投喂领域会话，
  // 阻止事件继续到达聚焦的抄录单元或明眼稿输入框
  useEffect(() => {
    if (!checking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSession((prev) => pressKey(prev, { key: e.key, repeat: e.repeat }));
    };
    const onBlur = () => setSession((prev) => reportBlur(prev));
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [checking]);

  // 每进入检查中（首轮开始 / 重新检查）把焦点收回面板，
  // 避免“重新检查”按钮仍聚焦时回车、空格误触发按钮
  useEffect(() => {
    if (checking) panelRef.current?.focus();
  }, [checking, session.id]);

  const retry = () => setSession((prev) => startSession(prev));

  // React 层兜底：检查中不允许任何按键穿透到下层控件
  const swallowKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (checking) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="keycheck-overlay" data-testid="keycheck-dialog" data-state={session.status}>
      <div
        ref={panelRef}
        className="keycheck-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keycheck-title"
        tabIndex={-1}
        onKeyDown={swallowKey}
      >
        <h2 id="keycheck-title">六点键盘检查</h2>

        {session.status === 'checking' && (
          <>
            <p className="keycheck-prompt" data-testid="keycheck-expected">
              请按下点位 <strong>{session.expected}</strong>
            </p>
            <ol className="keycheck-dots" aria-label="本轮确认记录">
              {CHECK_DOTS.map((dot) => {
                const done = session.confirmed.includes(dot);
                const current = dot === session.expected;
                return (
                  <li
                    key={dot}
                    className={`keycheck-dot${done ? ' done' : ''}${current ? ' current' : ''}`}
                    data-dot={dot}
                    data-state={done ? 'confirmed' : current ? 'expected' : 'pending'}
                  >
                    {dot}
                  </li>
                );
              })}
            </ol>
            <p className="hint" data-testid="keycheck-confirmed">
              已确认：{session.confirmed.length === 0 ? '无' : session.confirmed.join('、')}
              （{session.confirmed.length}/{CHECK_DOTS.length}）
            </p>
            <p className="hint">依次按下 1 至 6；长按连发不计入。错序、按到非点位键或窗口失焦将立即判失败。</p>
          </>
        )}

        {session.status === 'failed' && session.failure && (
          <>
            <p className="keycheck-prompt keycheck-failed">检查失败</p>
            <p role="alert" className="error keycheck-reason" data-testid="keycheck-failure">
              {describeFailure(session.failure)}
            </p>
            <p className="hint">已确认：{session.confirmed.length === 0 ? '无' : session.confirmed.join('、')}</p>
            {/* 失败页只提供“重新检查”：新一轮为全新会话，确认记录清零 */}
            <button type="button" className="keycheck-primary" data-testid="keycheck-retry" onClick={retry}>
              重新检查
            </button>
          </>
        )}

        {session.status === 'passed' && (
          <>
            <p className="keycheck-prompt keycheck-passed">按键检查通过 ✓</p>
            <p className="hint">本轮确认记录（按下顺序）</p>
            <ol className="keycheck-dots" aria-label="本轮确认记录">
              {session.confirmed.map((dot, i) => (
                <li key={`${dot}-${i}`} className="keycheck-dot done" data-dot={dot} data-state="confirmed">
                  {dot}
                </li>
              ))}
            </ol>
            <p className="hint" data-testid="keycheck-confirmed">
              已确认：{session.confirmed.join('、')}（{session.confirmed.length}/{CHECK_DOTS.length}），
              长按连发未计入
            </p>
            <button type="button" className="keycheck-primary" data-testid="keycheck-finish" onClick={onClose}>
              返回校样台
            </button>
          </>
        )}
      </div>
    </div>
  );
}
