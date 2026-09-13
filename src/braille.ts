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
// 点位串导入：竖线分隔文本 → 抄录单元带
// ---------------------------------------------------------------------------

export type TranscriptError =
  | { kind: 'empty' }
  | { kind: 'empty-segment'; index: number }
  | { kind: 'dot-out-of-range'; index: number; char: string }
  | { kind: 'dot-duplicate'; index: number; dot: string }
  | { kind: 'dot-unsorted'; index: number };

export type TranscriptParse = { ok: true; cells: Cell[] } | { ok: false; error: TranscriptError };

/**
 * 解析供应商压点设备复制的竖线分隔点位串。
 *
 * 每格只接受升序且不重复的 1–6（如 `124`），空白盲文格写作下划线 `_`；
 * 竖线不得位于首尾或形成空格段。任一文本格出错即整体失败，
 * 返回首个出错格的下标（0 起）与结构化原因，调用方据此保留原抄录。
 */
export function parseTranscript(text: string): TranscriptParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: { kind: 'empty' } };
  const segments = trimmed.split('|');
  const cells: Cell[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '') return { ok: false, error: { kind: 'empty-segment', index: i } };
    if (seg === '_') {
      cells.push(SPACE_CELL);
      continue;
    }
    let cell = 0;
    let prev = 0;
    for (const ch of seg) {
      if (ch < '1' || ch > '6') {
        return { ok: false, error: { kind: 'dot-out-of-range', index: i, char: ch } };
      }
      const dot = Number(ch) as Dot;
      const mask = dotMask(dot);
      if ((cell & mask) !== 0) {
        return { ok: false, error: { kind: 'dot-duplicate', index: i, dot: ch } };
      }
      if (dot < prev) {
        return { ok: false, error: { kind: 'dot-unsorted', index: i } };
      }
      prev = dot;
      cell |= mask;
    }
    cells.push(cell);
  }
  return { ok: true, cells };
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

export function describeTranscriptError(error: TranscriptError): string {
  switch (error.kind) {
    case 'empty':
      return '点位串为空：请粘贴以竖线分隔的点位串';
    case 'empty-segment':
      return `第 ${error.index + 1} 文本格缺失内容：竖线不得位于首尾或形成空格段`;
    case 'dot-out-of-range':
      return `第 ${error.index + 1} 文本格含越界点“${error.char}”：每格只接受点位 1–6，空白格写作下划线 _`;
    case 'dot-duplicate':
      return `第 ${error.index + 1} 文本格重复点 ${error.dot}：每格点位不得重复`;
    case 'dot-unsorted':
      return `第 ${error.index + 1} 文本格点位乱序：每格点位须按 1–6 升序填写`;
  }
}
