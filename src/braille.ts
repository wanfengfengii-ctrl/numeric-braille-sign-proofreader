/**
 * 六点盲文核心模块。
 *
 * 点位编号：左列自上而下为 1、2、3，右列为 4、5、6。
 * 单元（Cell）以位掩码表示：点 n 对应比特 (1 << (n - 1))，
 * 因此两个单元直接比较掩码即等价于比较点集合。
 */

export type Dot = 1 | 2 | 3 | 4 | 5 | 6;
export type Cell = number;

export const DOTS: readonly Dot[] = [1, 2, 3, 4, 5, 6];

export const dotMask = (dot: Dot): number => 1 << (dot - 1);

export const cellOf = (dots: readonly Dot[]): Cell =>
  dots.reduce((cell, dot) => cell | dotMask(dot), 0);

export const cellHas = (cell: Cell, dot: Dot): boolean => (cell & dotMask(dot)) !== 0;

/** 数字标志：固定为点 3456 */
export const NUMBER_SIGN: Cell = cellOf([3, 4, 5, 6]);

/** 数字 1–0 的六点编码 */
export const DIGIT_CELLS: Readonly<Record<string, Cell>> = {
  '1': cellOf([1]),
  '2': cellOf([1, 2]),
  '3': cellOf([1, 4]),
  '4': cellOf([1, 4, 5]),
  '5': cellOf([1, 5]),
  '6': cellOf([1, 2, 4]),
  '7': cellOf([1, 2, 4, 5]),
  '8': cellOf([1, 2, 5]),
  '9': cellOf([2, 4]),
  '0': cellOf([2, 4, 5]),
};

/** 半角连字符：点 36 */
export const HYPHEN_CELL: Cell = cellOf([3, 6]);
/** 斜杠：点 34 */
export const SLASH_CELL: Cell = cellOf([3, 4]);
/** 空格：空单元 */
export const SPACE_CELL: Cell = 0;

const SEPARATORS: ReadonlySet<string> = new Set(['-', '/', ' ']);

const isSeparator = (ch: string): boolean => SEPARATORS.has(ch);
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

export type InputError =
  | { kind: 'empty' }
  | { kind: 'invalid-char'; char: string; index: number }
  | { kind: 'separator-edge'; index: number }
  | { kind: 'separator-consecutive'; index: number };

export type Validation = { ok: true } | { ok: false; error: InputError };

/**
 * 仅接受数字 0–9、半角连字符、斜杠和单个空格；
 * 分隔符不得位于首尾，也不得连续出现。
 */
export function validateCode(input: string): Validation {
  if (input.length === 0) return { ok: false, error: { kind: 'empty' } };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!isDigit(ch) && !isSeparator(ch)) {
      return { ok: false, error: { kind: 'invalid-char', char: ch, index: i } };
    }
  }
  if (isSeparator(input[0])) return { ok: false, error: { kind: 'separator-edge', index: 0 } };
  const last = input.length - 1;
  if (isSeparator(input[last])) return { ok: false, error: { kind: 'separator-edge', index: last } };
  for (let i = 1; i < input.length; i++) {
    if (isSeparator(input[i]) && isSeparator(input[i - 1])) {
      return { ok: false, error: { kind: 'separator-consecutive', index: i } };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 编码：明眼稿代码 → 目标单元带
// ---------------------------------------------------------------------------

/**
 * 每个连续数字段前必须且只能出现一个数字标志；
 * 任一分隔符都会结束数字状态。
 * 调用前须通过 validateCode 校验。
 */
export function encodeCode(input: string): Cell[] {
  const cells: Cell[] = [];
  let inNumber = false;
  for (const ch of input) {
    if (isDigit(ch)) {
      if (!inNumber) {
        cells.push(NUMBER_SIGN);
        inNumber = true;
      }
      cells.push(DIGIT_CELLS[ch]);
    } else {
      inNumber = false;
      cells.push(ch === '-' ? HYPHEN_CELL : ch === '/' ? SLASH_CELL : SPACE_CELL);
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// 解码：抄录单元带 → 可解读代码
// ---------------------------------------------------------------------------

export type DecodeErrorKind = 'missing-number-sign' | 'duplicate-number-sign' | 'unknown-cell';

export type DecodeResult =
  | { ok: true; code: string }
  | { ok: false; error: DecodeErrorKind; index: number };

/**
 * 逐单元解读。遇到缺少数字标志、数字标志重复或未知点阵时，
 * 不猜测字符，返回首个出错单元的下标。
 */
export function decodeCells(cells: readonly Cell[]): DecodeResult {
  let code = '';
  let inNumber = false;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === NUMBER_SIGN) {
      if (inNumber) return { ok: false, error: 'duplicate-number-sign', index: i };
      inNumber = true;
      continue;
    }
    if (cell === HYPHEN_CELL) {
      code += '-';
      inNumber = false;
      continue;
    }
    if (cell === SLASH_CELL) {
      code += '/';
      inNumber = false;
      continue;
    }
    if (cell === SPACE_CELL) {
      code += ' ';
      inNumber = false;
      continue;
    }
    const digit = Object.keys(DIGIT_CELLS).find((d) => DIGIT_CELLS[d] === cell);
    if (digit === undefined) return { ok: false, error: 'unknown-cell', index: i };
    if (!inNumber) return { ok: false, error: 'missing-number-sign', index: i };
    code += digit;
  }
  return { ok: true, code };
}

// ---------------------------------------------------------------------------
// 比较：以点集合为准
// ---------------------------------------------------------------------------

export type Comparison = { status: 'match' } | { status: 'mismatch'; firstDiff: number };

/**
 * 单元数量或任一点不同都判为不一致，并给出首个差异单元的下标。
 */
export function compareCells(target: readonly Cell[], actual: readonly Cell[]): Comparison {
  const len = Math.max(target.length, actual.length);
  for (let i = 0; i < len; i++) {
    const t = i < target.length ? target[i] : null;
    const a = i < actual.length ? actual[i] : null;
    if (t === null || a === null || t !== a) return { status: 'mismatch', firstDiff: i };
  }
  return { status: 'match' };
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

export function describeInputError(error: InputError): string {
  switch (error.kind) {
    case 'empty':
      return '请输入房间牌代码';
    case 'invalid-char':
      return `包含表外字符“${error.char}”：仅允许数字 0–9、半角连字符 -、斜杠 / 与单个空格`;
    case 'separator-edge':
      return '分隔符（连字符、斜杠、空格）不得位于代码首尾';
    case 'separator-consecutive':
      return '分隔符（连字符、斜杠、空格）不得连续出现';
  }
}

export function describeDecodeError(error: DecodeErrorKind, index: number): string {
  const at = `第 ${index + 1} 单元`;
  switch (error) {
    case 'missing-number-sign':
      return `${at}缺少数字标志`;
    case 'duplicate-number-sign':
      return `${at}数字标志重复`;
    case 'unknown-cell':
      return `${at}为未知点阵`;
  }
}
