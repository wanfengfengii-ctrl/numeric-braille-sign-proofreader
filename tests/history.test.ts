import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redoEdit,
  undoEdit,
} from '../src/history';
import { DIGIT_CELLS, NUMBER_SIGN, cellOf, encodeCode, parseTranscript } from '../src/braille';

const D = (digit: string) => DIGIT_CELLS[digit];

describe('抄录历史：起点与边界', () => {
  it('新起点不可撤销、不可重做', () => {
    const history = createHistory([NUMBER_SIGN, D('1')]);
    expect(history.present).toEqual([NUMBER_SIGN, D('1')]);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('历史边界处撤销/重做原样返回，不改动现场', () => {
    const fresh = createHistory([NUMBER_SIGN]);
    expect(undoEdit(fresh)).toBe(fresh);
    expect(redoEdit(fresh)).toBe(fresh);

    // 撤销到底后再撤销、重做到顶后再重做：现场保持不变
    let history = recordEdit(fresh, [NUMBER_SIGN, D('1')]);
    history = undoEdit(history);
    expect(canUndo(history)).toBe(false);
    expect(undoEdit(history)).toBe(history);
    expect(history.present).toEqual([NUMBER_SIGN]);

    history = redoEdit(history);
    expect(canRedo(history)).toBe(false);
    expect(redoEdit(history)).toBe(history);
    expect(history.present).toEqual([NUMBER_SIGN, D('1')]);
  });

  it('历史快照复制为独立数组，后续修改来源数组不影响历史', () => {
    const initial = [NUMBER_SIGN, D('1')];
    const next = [NUMBER_SIGN, D('2')];
    let history = createHistory(initial);
    history = recordEdit(history, next);
    initial.push(D('3'));
    next.push(D('4'));
    expect(history.past[0]).toEqual([NUMBER_SIGN, D('1')]);
    expect(history.present).toEqual([NUMBER_SIGN, D('2')]);
  });
});

describe('抄录历史：推进', () => {
  it('逐步撤销回到每次有效编辑前，逐步重做恢复刚撤销的内容', () => {
    // 模拟连续现场：添加单元 → 切换点位 → 再添加单元
    const states: number[][] = [
      [],
      [0],
      [NUMBER_SIGN],
      [NUMBER_SIGN, 0],
    ];
    let history = createHistory(states[0]);
    for (let i = 1; i < states.length; i++) history = recordEdit(history, states[i]);
    expect(history.present).toEqual(states[3]);

    // 撤销逐站回退
    for (let i = states.length - 2; i >= 0; i--) {
      expect(canUndo(history)).toBe(true);
      history = undoEdit(history);
      expect(history.present).toEqual(states[i]);
    }
    expect(canUndo(history)).toBe(false);

    // 重做逐站前进，内容与撤销前一致
    for (let i = 1; i < states.length; i++) {
      expect(canRedo(history)).toBe(true);
      history = redoEdit(history);
      expect(history.present).toEqual(states[i]);
    }
    expect(canRedo(history)).toBe(false);
  });

  it('一次点位串导入只形成一个历史步骤：一次撤销整体回到导入前', () => {
    const before = [NUMBER_SIGN, D('1')];
    const parsed = parseTranscript('3456|1|12|36|3456|14');
    if (!parsed.ok) throw new Error('应解析成功');

    let history = createHistory(before);
    history = recordEdit(history, parsed.cells);

    // 导入的 6 个单元是一步：一次撤销即整体回到导入前，而非逐格回退
    history = undoEdit(history);
    expect(history.present).toEqual(before);
    expect(canUndo(history)).toBe(false);

    history = redoEdit(history);
    expect(history.present).toEqual(encodeCode('12-3'));
  });
});

describe('抄录历史：分支截断', () => {
  it('撤销后产生新编辑时丢弃后续重做分支', () => {
    let history = createHistory([]);
    history = recordEdit(history, [NUMBER_SIGN]);
    history = recordEdit(history, [NUMBER_SIGN, D('1')]);
    history = recordEdit(history, [NUMBER_SIGN, D('1'), D('2')]);

    // 撤销两步后改走新现场：被撤销的两步不再可重做
    history = undoEdit(history);
    history = undoEdit(history);
    expect(canRedo(history)).toBe(true);

    history = recordEdit(history, [cellOf([1, 3])]);
    expect(canRedo(history)).toBe(false);
    expect(redoEdit(history)).toBe(history);
    expect(history.present).toEqual([cellOf([1, 3])]);

    // 新分支自身照常撤销：回到新编辑前，而非旧分支现场
    history = undoEdit(history);
    expect(history.present).toEqual([NUMBER_SIGN]);
    // 更早的撤销链不受影响，可一路回到最初现场
    history = undoEdit(history);
    expect(history.present).toEqual([]);
    expect(canUndo(history)).toBe(false);
  });
});

describe('抄录历史：无变化编辑', () => {
  it('已有完整抄录时再次导入相同点集合，不推进有效编辑历史', () => {
    // 房间牌已有完整抄录（如新起点或刚恢复的草稿），不可撤销、不可重做
    const complete = [NUMBER_SIGN, D('1'), D('2')];
    const history = createHistory(complete);

    // 再次导入与当前现场相同的点位串：历史对象原样返回，不产生撤销后毫无变化的空步骤
    expect(recordEdit(history, [NUMBER_SIGN, D('1'), D('2')])).toBe(history);
    expect(history.past).toEqual([]);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(history.present).toEqual(complete);
  });

  it('单元数相同但掩码不同仍属有效编辑，照常推进历史', () => {
    let history = createHistory([NUMBER_SIGN]);
    history = recordEdit(history, [D('1')]);
    expect(history.past.length).toBe(1);
    expect(history.present).toEqual([D('1')]);
  });

  it('撤销后导入与当前现场相同的点集合时保留可重做分支', () => {
    // 先手工抄录一格，再成功导入完整点位串
    let history = createHistory([NUMBER_SIGN]);
    history = recordEdit(history, [NUMBER_SIGN, D('1'), D('2')]);

    // 撤销抄录：现场回到导入前的单格，重做分支出现
    history = undoEdit(history);
    expect(history.present).toEqual([NUMBER_SIGN]);
    expect(canRedo(history)).toBe(true);

    // 导入与当前现场相同的点位串：抄录内容未变，历史原样返回，重做机会不得被清除
    const noop = recordEdit(history, [NUMBER_SIGN]);
    expect(noop).toBe(history);
    expect(noop.present).toEqual([NUMBER_SIGN]);
    expect(canRedo(noop)).toBe(true);

    // 可恢复分支内容不受影响：重做仍回到完整导入现场
    history = redoEdit(noop);
    expect(history.present).toEqual([NUMBER_SIGN, D('1'), D('2')]);
    expect(canRedo(history)).toBe(false);
  });
});

describe('抄录历史：容量边界', () => {
  it(`撤销步数封顶 ${HISTORY_LIMIT}，超出时丢弃最旧记录`, () => {
    let history = createHistory([]);
    // 依次推入 HISTORY_LIMIT + 10 步编辑，第 i 步现场为 [i]
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      history = recordEdit(history, [i]);
    }
    expect(history.past.length).toBe(HISTORY_LIMIT);
    expect(history.present).toEqual([HISTORY_LIMIT + 9]);

    // 只能撤销 HISTORY_LIMIT 步：最旧可及现场是第 10 步编辑后的 [9]，
    // 最初的空现场与前 9 步（[] 与 [0]–[8]）已被丢弃
    for (let i = 0; i < HISTORY_LIMIT; i++) {
      expect(canUndo(history)).toBe(true);
      history = undoEdit(history);
    }
    expect(canUndo(history)).toBe(false);
    expect(history.present).toEqual([9]);

    // 重做同样只能回到最新现场，步数对称
    for (let i = 0; i < HISTORY_LIMIT; i++) history = redoEdit(history);
    expect(canRedo(history)).toBe(false);
    expect(history.present).toEqual([HISTORY_LIMIT + 9]);
  });

  it('恰好达到上限时全部步骤仍可撤销', () => {
    let history = createHistory([]);
    for (let i = 0; i < HISTORY_LIMIT; i++) history = recordEdit(history, [i]);
    expect(history.past.length).toBe(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) history = undoEdit(history);
    expect(history.present).toEqual([]);
    expect(canUndo(history)).toBe(false);
  });
});
