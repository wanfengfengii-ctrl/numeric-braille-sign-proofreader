/**
 * 抄录历史：Cell 数组编辑的撤销/重做。
 *
 * 每次有效编辑（点位切换、添加、插入、删除、清空、成功导入）
 * 把编辑前的现场压入过去栈，形成一步可撤销记录；
 * 撤销/重做在过去栈与未来栈之间移动当前现场，
 * 当前现场交由 decodeCells / compareCells 重新计算判定。
 *
 * 历史步数有上限，超出时丢弃最旧的记录；
 * 撤销后产生新编辑时，整条重做分支随之丢弃。
 */
import type { Cell } from './braille';

/** 历史上限：最多保留的撤销步数，超出时丢弃最旧记录 */
export const HISTORY_LIMIT = 100;

export interface CellHistory {
  /** 可撤销的现场快照，最近一次编辑前的现场在末尾 */
  readonly past: readonly Cell[][];
  /** 当前抄录现场 */
  readonly present: Cell[];
  /** 可重做的现场快照，最近撤销的现场在开头 */
  readonly future: readonly Cell[][];
}

/** 以当前现场为唯一起点建立历史：初始不可撤销、不可重做 */
export function createHistory(present: readonly Cell[]): CellHistory {
  return { past: [], present: [...present], future: [] };
}

export const canUndo = (history: CellHistory): boolean => history.past.length > 0;

export const canRedo = (history: CellHistory): boolean => history.future.length > 0;

/**
 * 记录一次有效编辑：当前现场压入过去栈（超出上限丢弃最旧），
 * 新现场成为当前现场，撤销后未重做的分支整体丢弃。
 * 快照复制为独立数组，后续修改来源数组不影响历史。
 */
export function recordEdit(history: CellHistory, next: readonly Cell[]): CellHistory {
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: [...next], future: [] };
}

/** 撤销到最近一次有效编辑前；已在最早历史边界时原样返回，不改动现场 */
export function undoEdit(history: CellHistory): CellHistory {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/** 重做刚撤销的内容；已在最新历史边界时原样返回，不改动现场 */
export function redoEdit(history: CellHistory): CellHistory {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next, future };
}
