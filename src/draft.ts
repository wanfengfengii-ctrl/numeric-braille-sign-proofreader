/**
 * 本地草稿：明眼稿、实物抄录单元与点位串输入的持久化。
 *
 * 草稿只保存原始录入数据，不保存判定结果；
 * 恢复后由 validateCode / decodeCells / compareCells 重新计算结论。
 */
import type { Cell } from './braille';

/** 六点位掩码上限：点 1–6 对应比特 0–5，合法单元取值 0–63 */
export const CELL_MASK_MAX = 0b111111;

/** 草稿模式标识与版本：防止误读其他应用或旧结构的缓存 */
export const DRAFT_SCHEMA = 'braille-proofing-station/draft';
export const DRAFT_VERSION = 1;

export interface ProofingDraft {
  schema: typeof DRAFT_SCHEMA;
  version: typeof DRAFT_VERSION;
  /** 明眼稿房间牌代码（原始输入，合法性恢复后重算） */
  input: string;
  /** 实物抄录单元（位掩码数组） */
  cells: Cell[];
  /** 点位串输入框原文 */
  transcript: string;
}

export type DraftError =
  | { kind: 'not-json' }
  | { kind: 'not-object' }
  | { kind: 'bad-schema' }
  | { kind: 'bad-version' }
  | { kind: 'bad-field'; field: 'input' | 'cells' | 'transcript' }
  | { kind: 'bad-cell'; index: number };

export type DraftParse = { ok: true; draft: ProofingDraft } | { ok: false; error: DraftError };

/** 汇集当前工作区为一份草稿（cells 复制为独立数组） */
export function createDraft(
  input: string,
  cells: readonly Cell[],
  transcript: string,
): ProofingDraft {
  return { schema: DRAFT_SCHEMA, version: DRAFT_VERSION, input, cells: [...cells], transcript };
}

export function serializeDraft(draft: ProofingDraft): string {
  return JSON.stringify(draft);
}

/**
 * 解析并逐字段校验本地草稿。
 * 无法解析、模式或版本不符、字段类型错误、单元值超出六点位掩码（0–63）
 * 都整体判为损坏，不返回部分可用数据，避免污染空白工作区。
 */
export function parseDraft(raw: string): DraftParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: { kind: 'not-json' } };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: { kind: 'not-object' } };
  }
  const record = data as Record<string, unknown>;
  if (record.schema !== DRAFT_SCHEMA) return { ok: false, error: { kind: 'bad-schema' } };
  if (record.version !== DRAFT_VERSION) return { ok: false, error: { kind: 'bad-version' } };
  if (typeof record.input !== 'string') {
    return { ok: false, error: { kind: 'bad-field', field: 'input' } };
  }
  if (typeof record.transcript !== 'string') {
    return { ok: false, error: { kind: 'bad-field', field: 'transcript' } };
  }
  if (!Array.isArray(record.cells)) {
    return { ok: false, error: { kind: 'bad-field', field: 'cells' } };
  }
  for (let i = 0; i < record.cells.length; i++) {
    const cell = record.cells[i];
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > CELL_MASK_MAX) {
      return { ok: false, error: { kind: 'bad-cell', index: i } };
    }
  }
  return {
    ok: true,
    draft: {
      schema: DRAFT_SCHEMA,
      version: DRAFT_VERSION,
      input: record.input,
      cells: record.cells as Cell[],
      transcript: record.transcript,
    },
  };
}

export function describeDraftError(error: DraftError): string {
  switch (error.kind) {
    case 'not-json':
      return '内容无法解析';
    case 'not-object':
      return '内容不是草稿对象';
    case 'bad-schema':
      return '模式标识不匹配';
    case 'bad-version':
      return '草稿版本不受支持';
    case 'bad-field':
      return `字段 ${error.field} 类型错误`;
    case 'bad-cell':
      return `第 ${error.index + 1} 单元的值超出六点位掩码`;
  }
}
