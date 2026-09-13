import { describe, expect, it } from 'vitest';
import {
  type Dot,
  DIGIT_CELLS,
  HYPHEN_CELL,
  NUMBER_SIGN,
  SLASH_CELL,
  SPACE_CELL,
  cellOf,
  compareCells,
  decodeCells,
  describeDecodeError,
  describeTranscriptError,
  encodeCode,
  parseTranscript,
  validateCode,
} from '../src/braille';

const D = (digit: string) => DIGIT_CELLS[digit];

describe('六点映射锁定', () => {
  it('数字标志固定为 3456', () => {
    expect(NUMBER_SIGN).toBe(cellOf([3, 4, 5, 6]));
    expect(NUMBER_SIGN).toBe(0b111100);
  });

  it('数字 1–0 依次编码为 1、12、14、145、15、124、1245、125、24、245', () => {
    const expected: Record<string, { dots: Dot[]; mask: number }> = {
      '1': { dots: [1], mask: 0b000001 },
      '2': { dots: [1, 2], mask: 0b000011 },
      '3': { dots: [1, 4], mask: 0b001001 },
      '4': { dots: [1, 4, 5], mask: 0b011001 },
      '5': { dots: [1, 5], mask: 0b010001 },
      '6': { dots: [1, 2, 4], mask: 0b001011 },
      '7': { dots: [1, 2, 4, 5], mask: 0b011011 },
      '8': { dots: [1, 2, 5], mask: 0b010011 },
      '9': { dots: [2, 4], mask: 0b001010 },
      '0': { dots: [2, 4, 5], mask: 0b011010 },
    };
    for (const [digit, { dots, mask }] of Object.entries(expected)) {
      expect(D(digit), `数字 ${digit}`).toBe(cellOf(dots));
      expect(D(digit), `数字 ${digit}`).toBe(mask);
    }
  });

  it('连字符为 36，斜杠为 34，空格为空单元', () => {
    expect(HYPHEN_CELL).toBe(cellOf([3, 6]));
    expect(SLASH_CELL).toBe(cellOf([3, 4]));
    expect(SPACE_CELL).toBe(0);
  });
});

describe('输入校验', () => {
  it.each(['0', '5', '123', '1-2', '1/2', '1 2', '12-3/4 5', '9-8/7 6'])(
    '接受合法代码：%s',
    (code) => {
      expect(validateCode(code)).toEqual({ ok: true });
    },
  );

  it.each(['A', '12A', 'a1', '1,2', '１２', '1.2', '1\t2', '1~2'])('拒绝表外字符：%s', (code) => {
    const r = validateCode(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-char');
  });

  it.each(['-1', '/1', ' 1', '1-', '1/', '1 ', '-'])('拒绝分隔符位于首尾：%s', (code) => {
    const r = validateCode(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('separator-edge');
  });

  it.each(['1--2', '1//2', '1  2', '1- 2', '1 -2', '1/ 2'])('拒绝分隔符连续出现：%s', (code) => {
    const r = validateCode(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('separator-consecutive');
  });

  it('空输入', () => {
    const r = validateCode('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('empty');
  });
});

describe('编码：数字状态', () => {
  it('单段数字前置且仅一个数字标志', () => {
    expect(encodeCode('123')).toEqual([NUMBER_SIGN, D('1'), D('2'), D('3')]);
  });

  it('单个数字 0', () => {
    expect(encodeCode('0')).toEqual([NUMBER_SIGN, D('0')]);
  });

  it('每个连续数字段前都有且只有一个数字标志，分隔符结束数字状态', () => {
    expect(encodeCode('12-3/4 5')).toEqual([
      NUMBER_SIGN, D('1'), D('2'), HYPHEN_CELL,
      NUMBER_SIGN, D('3'), SLASH_CELL,
      NUMBER_SIGN, D('4'), SPACE_CELL,
      NUMBER_SIGN, D('5'),
    ]);
  });

  it('相邻数字段各自重新加标志', () => {
    expect(encodeCode('1-2')).toEqual([NUMBER_SIGN, D('1'), HYPHEN_CELL, NUMBER_SIGN, D('2')]);
  });
});

describe('解码：反向解读', () => {
  it.each(['0', '1', '9', '123', '12-3/4 5', '7-8/9 0'])('编码后解码还原：%s', (code) => {
    expect(decodeCells(encodeCode(code))).toEqual({ ok: true, code });
  });

  it('空单元解读为空格并结束数字状态', () => {
    expect(decodeCells([NUMBER_SIGN, D('1'), SPACE_CELL, NUMBER_SIGN, D('2')])).toEqual({
      ok: true,
      code: '1 2',
    });
  });

  it('缺少数字标志：不猜测字符', () => {
    expect(decodeCells([D('5')])).toEqual({ ok: false, error: 'missing-number-sign', index: 0 });
  });

  it('分隔符结束数字状态后仍须新标志', () => {
    expect(decodeCells([NUMBER_SIGN, D('1'), HYPHEN_CELL, D('2')])).toEqual({
      ok: false,
      error: 'missing-number-sign',
      index: 3,
    });
    expect(decodeCells([NUMBER_SIGN, D('1'), SPACE_CELL, D('2')])).toEqual({
      ok: false,
      error: 'missing-number-sign',
      index: 3,
    });
  });

  it('数字标志重复', () => {
    expect(decodeCells([NUMBER_SIGN, NUMBER_SIGN])).toEqual({
      ok: false,
      error: 'duplicate-number-sign',
      index: 1,
    });
    expect(decodeCells([NUMBER_SIGN, D('1'), NUMBER_SIGN])).toEqual({
      ok: false,
      error: 'duplicate-number-sign',
      index: 2,
    });
  });

  it('未知点阵：不猜测字符', () => {
    expect(decodeCells([cellOf([6])])).toEqual({ ok: false, error: 'unknown-cell', index: 0 });
    expect(decodeCells([NUMBER_SIGN, D('1'), cellOf([1, 3])])).toEqual({
      ok: false,
      error: 'unknown-cell',
      index: 2,
    });
  });
});

describe('解码：房间牌代码结构', () => {
  it('仅含数字标志：数字段结构不完整，不解读为空代码', () => {
    expect(decodeCells([NUMBER_SIGN])).toEqual({
      ok: false,
      error: 'incomplete-number',
      index: 0,
    });
  });

  it('数字标志后未跟数字即遇分隔符或带尾：指向悬空标志', () => {
    expect(decodeCells([NUMBER_SIGN, HYPHEN_CELL, NUMBER_SIGN, D('1')])).toEqual({
      ok: false,
      error: 'incomplete-number',
      index: 0,
    });
    expect(decodeCells([NUMBER_SIGN, D('1'), SPACE_CELL, NUMBER_SIGN])).toEqual({
      ok: false,
      error: 'incomplete-number',
      index: 3,
    });
  });

  it('首位分隔符：拒绝', () => {
    for (const sep of [HYPHEN_CELL, SLASH_CELL, SPACE_CELL]) {
      expect(decodeCells([sep, NUMBER_SIGN, D('1')])).toEqual({
        ok: false,
        error: 'separator-edge',
        index: 0,
      });
    }
  });

  it('末尾分隔符：报告结构非法', () => {
    for (const sep of [HYPHEN_CELL, SLASH_CELL, SPACE_CELL]) {
      expect(decodeCells([NUMBER_SIGN, D('1'), sep])).toEqual({
        ok: false,
        error: 'separator-edge',
        index: 2,
      });
    }
  });

  it('连续分隔符：拒绝连续分隔结构', () => {
    expect(
      decodeCells([NUMBER_SIGN, D('1'), HYPHEN_CELL, SLASH_CELL, NUMBER_SIGN, D('2')]),
    ).toEqual({ ok: false, error: 'separator-consecutive', index: 3 });
    expect(decodeCells([NUMBER_SIGN, D('1'), SPACE_CELL, HYPHEN_CELL, NUMBER_SIGN, D('2')])).toEqual(
      { ok: false, error: 'separator-consecutive', index: 3 },
    );
  });

  it('空单元带仍解读为空代码', () => {
    expect(decodeCells([])).toEqual({ ok: true, code: '' });
  });

  it('结构性错误的文案', () => {
    expect(describeDecodeError('incomplete-number', 0)).toContain('第 1 单元');
    expect(describeDecodeError('incomplete-number', 0)).toContain('数字段结构不完整');
    expect(describeDecodeError('separator-edge', 2)).toContain('第 3 单元');
    expect(describeDecodeError('separator-edge', 2)).toContain('不得位于首尾');
    expect(describeDecodeError('separator-consecutive', 3)).toContain('第 4 单元');
    expect(describeDecodeError('separator-consecutive', 3)).toContain('不得连续出现');
  });
});

describe('点位串导入：文本格 → Cell 映射', () => {
  it('单格点位串映射为位掩码', () => {
    expect(parseTranscript('3456')).toEqual({ ok: true, cells: [NUMBER_SIGN] });
    expect(parseTranscript('1')).toEqual({ ok: true, cells: [D('1')] });
    expect(parseTranscript('12')).toEqual({ ok: true, cells: [D('2')] });
    expect(parseTranscript('36')).toEqual({ ok: true, cells: [HYPHEN_CELL] });
    expect(parseTranscript('34')).toEqual({ ok: true, cells: [SLASH_CELL] });
  });

  it('下划线为空白盲文格（空单元）', () => {
    expect(parseTranscript('_')).toEqual({ ok: true, cells: [SPACE_CELL] });
    // 点位串写的是点位而非数字：格 “2” 即点 2，对应掩码 0b000010
    expect(parseTranscript('1|_|2')).toEqual({ ok: true, cells: [D('1'), SPACE_CELL, cellOf([2])] });
  });

  it('多格点位串按竖线拆分，与 encodeCode 的目标单元带一致', () => {
    const parsed = parseTranscript('3456|1|12|36|3456|14|34|3456|145|_|3456|15');
    expect(parsed).toEqual({ ok: true, cells: encodeCode('12-3/4 5') });
  });

  it('解析结果可直接进入 decodeCells 与 compareCells', () => {
    const parsed = parseTranscript('3456|1|12|36|3456|14|34|3456|145|_|3456|15');
    if (!parsed.ok) throw new Error('应解析成功');
    expect(decodeCells(parsed.cells)).toEqual({ ok: true, code: '12-3/4 5' });
    expect(compareCells(encodeCode('12-3/4 5'), parsed.cells)).toEqual({ status: 'match' });
  });

  it('忽略整体首尾空白（复制粘贴常带换行）', () => {
    expect(parseTranscript('  3456|1\n')).toEqual({ ok: true, cells: [NUMBER_SIGN, D('1')] });
  });
});

describe('点位串导入：结构化错误', () => {
  it('空串与纯空白', () => {
    expect(parseTranscript('')).toEqual({ ok: false, error: { kind: 'empty' } });
    expect(parseTranscript('  \n ')).toEqual({ ok: false, error: { kind: 'empty' } });
  });

  it('竖线位于首尾或形成空格段：指出缺失内容的文本格', () => {
    expect(parseTranscript('|1')).toEqual({ ok: false, error: { kind: 'empty-segment', index: 0 } });
    expect(parseTranscript('1|')).toEqual({ ok: false, error: { kind: 'empty-segment', index: 1 } });
    expect(parseTranscript('1||12')).toEqual({ ok: false, error: { kind: 'empty-segment', index: 1 } });
    expect(parseTranscript('1|12||3456')).toEqual({
      ok: false,
      error: { kind: 'empty-segment', index: 2 },
    });
  });

  it('越界点：0、7–9、字母及混排的下划线', () => {
    expect(parseTranscript('17')).toEqual({
      ok: false,
      error: { kind: 'dot-out-of-range', index: 0, char: '7' },
    });
    expect(parseTranscript('10')).toEqual({
      ok: false,
      error: { kind: 'dot-out-of-range', index: 0, char: '0' },
    });
    expect(parseTranscript('3456|1a')).toEqual({
      ok: false,
      error: { kind: 'dot-out-of-range', index: 1, char: 'a' },
    });
    expect(parseTranscript('_1')).toEqual({
      ok: false,
      error: { kind: 'dot-out-of-range', index: 0, char: '_' },
    });
  });

  it('重复点：指出文本格与点位', () => {
    expect(parseTranscript('11')).toEqual({
      ok: false,
      error: { kind: 'dot-duplicate', index: 0, dot: '1' },
    });
    expect(parseTranscript('3456|122')).toEqual({
      ok: false,
      error: { kind: 'dot-duplicate', index: 1, dot: '2' },
    });
  });

  it('乱序：点位未按升序', () => {
    expect(parseTranscript('21')).toEqual({ ok: false, error: { kind: 'dot-unsorted', index: 0 } });
    expect(parseTranscript('1|143')).toEqual({ ok: false, error: { kind: 'dot-unsorted', index: 1 } });
  });

  it('首个出错格即返回，不继续解析后续格', () => {
    expect(parseTranscript('3456|99|21')).toEqual({
      ok: false,
      error: { kind: 'dot-out-of-range', index: 1, char: '9' },
    });
  });
});

describe('点位串导入：错误文案', () => {
  it('指出第几个文本格及原因', () => {
    expect(describeTranscriptError({ kind: 'empty' })).toContain('为空');
    expect(describeTranscriptError({ kind: 'empty-segment', index: 1 })).toContain('第 2 文本格');
    expect(describeTranscriptError({ kind: 'dot-out-of-range', index: 0, char: '7' })).toContain(
      '越界点',
    );
    expect(describeTranscriptError({ kind: 'dot-duplicate', index: 2, dot: '3' })).toContain(
      '第 3 文本格',
    );
    expect(describeTranscriptError({ kind: 'dot-unsorted', index: 0 })).toContain('乱序');
  });
});

describe('比较：以点集合为准', () => {
  const target = encodeCode('12-3');

  it('完全一致', () => {
    expect(compareCells(target, [...target])).toEqual({ status: 'match' });
  });

  it('任一点不同即不一致，并给出首个差异下标', () => {
    const actual = [...target];
    actual[2] = actual[2] ^ 0b000010; // 切换点 2
    expect(compareCells(target, actual)).toEqual({ status: 'mismatch', firstDiff: 2 });
  });

  it('单元数量不同即不一致', () => {
    expect(compareCells(target, target.slice(0, -1))).toEqual({
      status: 'mismatch',
      firstDiff: target.length - 1,
    });
    expect(compareCells(target, [...target, NUMBER_SIGN])).toEqual({
      status: 'mismatch',
      firstDiff: target.length,
    });
  });

  it('首个差异之前的相同单元不影响定位', () => {
    const actual = [NUMBER_SIGN, D('8'), D('2')];
    expect(compareCells([NUMBER_SIGN, D('1'), D('2')], actual)).toEqual({
      status: 'mismatch',
      firstDiff: 1,
    });
  });
});
