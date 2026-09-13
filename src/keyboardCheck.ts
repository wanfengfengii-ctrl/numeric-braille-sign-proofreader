/**
 * 六点键盘检查：换班或外接键盘更换后，先逐点确认数字点位键 1–6 可可靠使用，
 * 再进入正式抄录，避免按键缺失、顺序混乱或长按连发在抄录中才暴露。
 *
 * 本模块以检查会话（KeyboardCheckSession）为核心对象，所有状态转换都是纯函数：
 * 接收标准化按键事件（{ key, repeat }），返回新的会话快照，会话内含
 * 当前期望点位、已确认点位与 就绪/检查中/失败/通过 状态。
 *
 * 浏览器自动重复（KeyboardEvent.repeat，即长按连发）一律忽略，不计入确认结果；
 * 失败原因结构化区分错序点位键、非点位键与窗口失焦，界面据此明确显示
 * 期望键与实际原因。每轮重新检查都建立 id 递增的全新会话，不复用上一轮记录。
 */

export type CheckDot = 1 | 2 | 3 | 4 | 5 | 6;

/** 检查顺序固定为点位 1 至 6 */
export const CHECK_DOTS: readonly CheckDot[] = [1, 2, 3, 4, 5, 6];

export type CheckStatus = 'ready' | 'checking' | 'failed' | 'passed';

export type CheckFailure =
  | { kind: 'wrong-dot'; expected: CheckDot; actual: CheckDot }
  | { kind: 'non-dot-key'; expected: CheckDot; key: string }
  | { kind: 'blur'; expected: CheckDot };

/** 标准化按键事件：由界面层从 DOM KeyboardEvent 转换而来 */
export interface NormalizedKeyEvent {
  /** 对应 KeyboardEvent.key */
  key: string;
  /** 长按自动重复（KeyboardEvent.repeat）：为 true 时不计入结果 */
  repeat: boolean;
}

export interface KeyboardCheckSession {
  /** 会话序号：每轮检查（含重新检查）递增，标识一轮全新会话 */
  readonly id: number;
  readonly status: CheckStatus;
  /** 已确认点位，按命中顺序排列 */
  readonly confirmed: readonly CheckDot[];
  /** 当前期望点位；全部通过后为 null */
  readonly expected: CheckDot | null;
  /** 失败原因；仅在 status 为 failed 时非空 */
  readonly failure: CheckFailure | null;
}

/** 建立一轮会话：初始为就绪态，尚未开始计时检查 */
export function createSession(id = 0): KeyboardCheckSession {
  return { id, status: 'ready', confirmed: [], expected: 1, failure: null };
}

/**
 * 开启新一轮检查：就绪、失败或通过后调用，建立 id 递增的全新会话，
 * 已确认记录与失败原因不带入新会话。检查中重复调用原样返回，不另开会话。
 */
export function startSession(session: KeyboardCheckSession): KeyboardCheckSession {
  if (session.status === 'checking') return session;
  return { id: session.id + 1, status: 'checking', confirmed: [], expected: 1, failure: null };
}

/**
 * 投喂一个标准化按键事件，返回下一状态的会话快照。
 *
 * - 自动重复事件不计入结果，会话原样返回；
 * - 命中期望点位：记入已确认，期望推进到下一点位，第 6 点命中即通过；
 * - 顺序错误的 1–6、非点位键：立即结束本轮并记录结构化原因；
 * - 非检查中状态不响应，会话原样返回。
 */
export function pressKey(
  session: KeyboardCheckSession,
  event: NormalizedKeyEvent,
): KeyboardCheckSession {
  if (session.status !== 'checking') return session;
  // 长按连发：自动重复事件一律忽略，既不确认也不判错
  if (event.repeat) return session;
  const expected = session.expected;
  if (expected === null) return session;

  if (event.key.length === 1 && event.key >= '1' && event.key <= '6') {
    const actual = Number(event.key) as CheckDot;
    if (actual !== expected) {
      return { ...session, status: 'failed', failure: { kind: 'wrong-dot', expected, actual } };
    }
    const confirmed = [...session.confirmed, actual];
    if (actual === CHECK_DOTS[CHECK_DOTS.length - 1]) {
      return { ...session, status: 'passed', confirmed, expected: null };
    }
    return { ...session, confirmed, expected: (actual + 1) as CheckDot };
  }

  return {
    ...session,
    status: 'failed',
    failure: { kind: 'non-dot-key', expected, key: event.key },
  };
}

/**
 * 检查中窗口失焦：立即结束本轮并记录失焦时期望的点位。
 * 就绪、失败、通过状态下不报失焦，会话原样返回。
 */
export function reportBlur(session: KeyboardCheckSession): KeyboardCheckSession {
  if (session.status !== 'checking' || session.expected === null) return session;
  return { ...session, status: 'failed', failure: { kind: 'blur', expected: session.expected } };
}

/** 少量无名键的可读化，用于失败原因展示 */
export function describeKey(key: string): string {
  switch (key) {
    case ' ':
      return '空格';
    case 'Enter':
      return '回车';
    case 'Backspace':
      return '退格';
    case 'Tab':
      return 'Tab';
    case 'ArrowLeft':
      return '方向左键';
    case 'ArrowRight':
      return '方向右键';
    case 'ArrowUp':
      return '方向上键';
    case 'ArrowDown':
      return '方向下键';
    default:
      return key;
  }
}

/** 失败原因文案：始终同时给出期望键与实际原因 */
export function describeFailure(failure: CheckFailure): string {
  const expectedText = `期望按下点位 ${failure.expected}`;
  switch (failure.kind) {
    case 'wrong-dot':
      return `${expectedText}，实际按下点位 ${failure.actual}：点位顺序错误，本轮检查失败`;
    case 'non-dot-key':
      return `${expectedText}，实际按下非点位键“${describeKey(failure.key)}”，本轮检查失败`;
    case 'blur':
      return `${expectedText} 时检查窗口失焦，本轮检查失败`;
  }
}
