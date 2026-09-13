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
  encodeCode,
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
