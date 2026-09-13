import { describe, expect, it } from 'vitest';
import {
  CHECK_DOTS,
  createSession,
  describeFailure,
  pressKey,
  reportBlur,
  startSession,
} from '../src/keyboardCheck';

const press = (key: string, repeat = false) => ({ key, repeat });

/** 依次投喂 1 至 6 的全新按键（非自动重复） */
function passAll(session = startSession(createSession())) {
  for (const dot of CHECK_DOTS) session = pressKey(session, press(String(dot)));
  return session;
}

describe('键盘检查：会话起点', () => {
  it('新建会话为就绪态，期望点位 1，尚无确认记录', () => {
    const session = createSession();
    expect(session.status).toBe('ready');
    expect(session.expected).toBe(1);
    expect(session.confirmed).toEqual([]);
    expect(session.failure).toBeNull();
  });

  it('开始检查进入检查中，清空旧记录并递增会话 id', () => {
    const started = startSession(createSession());
    expect(started.id).toBe(1);
    expect(started.status).toBe('checking');
    expect(started.expected).toBe(1);
    expect(started.confirmed).toEqual([]);

    // 失败后重新检查：id 递增、确认记录与失败原因不带入
    const failed = pressKey(started, press('3'));
    const retried = startSession(failed);
    expect(retried.id).toBe(2);
    expect(retried.status).toBe('checking');
    expect(retried.expected).toBe(1);
    expect(retried.confirmed).toEqual([]);
    expect(retried.failure).toBeNull();
  });

  it('通过后再次开始也是全新会话（重新检查同样适用通过页）', () => {
    const passed = passAll();
    expect(passed.status).toBe('passed');
    const again = startSession(passed);
    expect(again.id).toBe(passed.id + 1);
    expect(again.confirmed).toEqual([]);
    expect(again.status).toBe('checking');
  });

  it('检查中重复开始原样返回，不另开会话', () => {
    const started = startSession(createSession());
    expect(startSession(started)).toBe(started);
  });
});

describe('键盘检查：状态转换', () => {
  it('依次按下 1 至 6：期望逐点推进，全部命中后通过', () => {
    let session = startSession(createSession());
    expect(session.expected).toBe(1);

    session = pressKey(session, press('1'));
    expect(session.status).toBe('checking');
    expect(session.confirmed).toEqual([1]);
    expect(session.expected).toBe(2);

    session = pressKey(session, press('2'));
    expect(session.confirmed).toEqual([1, 2]);
    expect(session.expected).toBe(3);

    for (const dot of [3, 4, 5]) {
      session = pressKey(session, press(String(dot)));
      expect(session.expected).toBe(dot + 1);
    }

    session = pressKey(session, press('6'));
    expect(session.status).toBe('passed');
    expect(session.expected).toBeNull();
    expect(session.confirmed).toEqual([1, 2, 3, 4, 5, 6]);
    expect(session.failure).toBeNull();
  });

  it('通过后再投喂按键不改变会话', () => {
    const passed = passAll();
    expect(pressKey(passed, press('1'))).toBe(passed);
    expect(reportBlur(passed)).toBe(passed);
  });

  it('就绪态投喂按键与失焦均无反应', () => {
    const ready = createSession();
    expect(pressKey(ready, press('1'))).toBe(ready);
    expect(reportBlur(ready)).toBe(ready);
  });

  it('失败终态不再响应后续按键', () => {
    const failed = pressKey(startSession(createSession()), press('a'));
    expect(failed.status).toBe('failed');
    expect(pressKey(failed, press('1'))).toBe(failed);
    expect(pressKey(failed, press('2'))).toBe(failed);
  });
});

describe('键盘检查：错误归因', () => {
  it('顺序错误的点位键：记录期望与实际点位，立即失败', () => {
    // 第 1 点已确认，期望 2 时按下 5
    let session = pressKey(startSession(createSession()), press('1'));
    session = pressKey(session, press('5'));
    expect(session.status).toBe('failed');
    expect(session.failure).toEqual({ kind: 'wrong-dot', expected: 2, actual: 5 });
    // 已确认记录保留到失败时刻
    expect(session.confirmed).toEqual([1]);
  });

  it('首个按键就错序：期望 1 实际 6', () => {
    const session = pressKey(startSession(createSession()), press('6'));
    expect(session.status).toBe('failed');
    expect(session.failure).toEqual({ kind: 'wrong-dot', expected: 1, actual: 6 });
    expect(session.confirmed).toEqual([]);
  });

  it('非点位键（字母、回车、空格等）立即失败并保留实际键名', () => {
    const byLetter = pressKey(startSession(createSession()), press('a'));
    expect(byLetter.failure).toEqual({ kind: 'non-dot-key', expected: 1, key: 'a' });

    let session = pressKey(startSession(createSession()), press('1'));
    session = pressKey(session, press('Enter'));
    expect(session.status).toBe('failed');
    expect(session.failure).toEqual({ kind: 'non-dot-key', expected: 2, key: 'Enter' });

    session = pressKey(startSession(createSession()), press(' '));
    expect(session.failure).toEqual({ kind: 'non-dot-key', expected: 1, key: ' ' });
  });

  it('窗口失焦：立即失败并记录失焦时的期望点位', () => {
    let session = pressKey(startSession(createSession()), press('1'));
    session = pressKey(session, press('2'));
    session = reportBlur(session);
    expect(session.status).toBe('failed');
    expect(session.failure).toEqual({ kind: 'blur', expected: 3 });
    expect(session.confirmed).toEqual([1, 2]);
  });

  it('失败原因文案同时给出期望键与实际原因', () => {
    expect(describeFailure({ kind: 'wrong-dot', expected: 2, actual: 5 })).toContain('期望按下点位 2');
    expect(describeFailure({ kind: 'wrong-dot', expected: 2, actual: 5 })).toContain('实际按下点位 5');

    const nonDot = describeFailure({ kind: 'non-dot-key', expected: 1, key: 'a' });
    expect(nonDot).toContain('期望按下点位 1');
    expect(nonDot).toContain('非点位键');
    expect(nonDot).toContain('a');

    const blur = describeFailure({ kind: 'blur', expected: 4 });
    expect(blur).toContain('期望按下点位 4');
    expect(blur).toContain('失焦');
  });
});

describe('键盘检查：自动重复过滤', () => {
  it('长按连发（repeat=true）既不计入确认也不判错', () => {
    let session = startSession(createSession());
    // 长按 1 产生 1 次真实按下 + 若干自动重复
    session = pressKey(session, press('1', false));
    for (let i = 0; i < 5; i++) session = pressKey(session, press('1', true));
    expect(session.status).toBe('checking');
    expect(session.confirmed).toEqual([1]);
    expect(session.expected).toBe(2);

    // 期望 2 时长按 1 的自动重复上送：按非期望点位也不得判错
    session = pressKey(session, press('1', true));
    expect(session.status).toBe('checking');
    expect(session.expected).toBe(2);

    // 非点位键的自动重复同样忽略
    session = pressKey(session, press('Enter', true));
    expect(session.status).toBe('checking');

    // 真实按下继续正常推进直至通过
    session = pressKey(session, press('2'));
    for (const dot of [3, 4, 5, 6]) session = pressKey(session, press(String(dot), false));
    expect(session.status).toBe('passed');
    expect(session.confirmed).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('每轮重新检查后自动重复计数不串轮', () => {
    const failed = pressKey(startSession(createSession()), press('1', true)); // 重复忽略，仍在检查
    expect(failed.status).toBe('checking');
    const failedWrong = pressKey(failed, press('3')); // 真实错序
    expect(failedWrong.status).toBe('failed');
    const retried = startSession(failedWrong);
    expect(retried.confirmed).toEqual([]);
    expect(pressKey(retried, press('1', true)).confirmed).toEqual([]);
    const afterReal = pressKey(retried, press('1', false));
    expect(afterReal.confirmed).toEqual([1]);
  });
});
