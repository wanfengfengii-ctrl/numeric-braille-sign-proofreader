import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  type Cell,
  type Dot,
  type TranscriptError,
  compareCells,
  decodeCells,
  describeDecodeError,
  describeInputError,
  describeTranscriptError,
  dotMask,
  encodeCode,
  parseTranscript,
  validateCode,
} from './braille';
import {
  type DraftError,
  type ProofingDraft,
  createDraft,
  describeDraftError,
  parseDraft,
  serializeDraft,
} from './draft';
import {
  type CellHistory,
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redoEdit,
  undoEdit,
} from './history';
import { DotGrid } from './DotGrid';

/** 本地草稿的 localStorage 键 */
const DRAFT_STORAGE_KEY = 'braille-proofing-station/draft/v1';

type DraftPrompt =
  | { state: 'none' }
  | { state: 'restore'; draft: ProofingDraft }
  | { state: 'corrupt'; error: DraftError };

/** 启动时读取本地草稿：无草稿照常启动；损坏草稿只提示，不还原任何字段 */
function readStoredDraft(): DraftPrompt {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null) return { state: 'none' };
    const parsed = parseDraft(raw);
    return parsed.ok
      ? { state: 'restore', draft: parsed.draft }
      : { state: 'corrupt', error: parsed.error };
  } catch {
    // 存储不可用（如隐私模式）时按无草稿处理
    return { state: 'none' };
  }
}

/** 草稿内容摘要，帮助校样员确认是否为未送厂的现场 */
function draftSummary(draft: ProofingDraft): string {
  const parts: string[] = [];
  if (draft.input !== '') parts.push(`明眼稿「${draft.input}」`);
  if (draft.cells.length > 0) parts.push(`抄录 ${draft.cells.length} 单元`);
  if (draft.transcript !== '') parts.push('含点位串输入');
  return parts.join('，');
}

type Verdict =
  | { state: 'idle'; message: string }
  | { state: 'input-error'; message: string }
  | { state: 'decode-error'; message: string }
  | { state: 'match'; message: string }
  | { state: 'mismatch'; message: string; firstDiff: number };

export default function App() {
  const [input, setInput] = useState('');
  // 抄录单元纳入有上限的历史：撤销/重做只移动历史指针，判定随当前现场重算
  const [history, setHistory] = useState<CellHistory>(() => createHistory([]));
  const cells = history.present;
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [transcriptError, setTranscriptError] = useState<TranscriptError | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<DraftPrompt>(readStoredDraft);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);

  const validation = useMemo(() => validateCode(input), [input]);
  const target = useMemo(() => (validation.ok ? encodeCode(input) : null), [validation, input]);
  const decode = useMemo(() => decodeCells(cells), [cells]);

  // 比较只看点集合：单元数量或任一点不同即不一致
  const comparison = useMemo(() => {
    if (!target || cells.length === 0) return null;
    return compareCells(target, cells);
  }, [target, cells]);

  const firstDiff = comparison?.status === 'mismatch' ? comparison.firstDiff : null;

  // 表外字符、缺少/重复数字标志、未知点阵：不猜测，清除旧的一致结果
  const verdict: Verdict = useMemo(() => {
    if (!validation.ok) {
      return validation.error.kind === 'empty'
        ? { state: 'idle', message: '等待输入房间牌代码' }
        : { state: 'input-error', message: describeInputError(validation.error) };
    }
    if (cells.length === 0) return { state: 'idle', message: '等待抄录实物单元' };
    if (!decode.ok) {
      return {
        state: 'decode-error',
        message: `无法解读抄录：${describeDecodeError(decode.error, decode.index)}，判定结果已清除`,
      };
    }
    if (comparison?.status === 'match') {
      return { state: 'match', message: '房间牌一致 ✓ 可以送厂' };
    }
    if (comparison?.status === 'mismatch') {
      const i = comparison.firstDiff;
      const detail =
        i >= cells.length ? '抄录缺少该单元' : i >= (target?.length ?? 0) ? '抄录多出该单元' : '点位不同';
      return {
        state: 'mismatch',
        message: `不一致：首个差异位于第 ${i + 1} 单元（${detail}），可直接返工`,
        firstDiff: i,
      };
    }
    return { state: 'idle', message: '等待比较' };
  }, [validation, cells.length, decode, comparison, target]);

  // 键盘焦点管理
  useEffect(() => {
    if (focusIdx !== null) cellRefs.current[focusIdx]?.focus();
  }, [focusIdx, cells.length]);

  // 聚焦首个差异单元
  useEffect(() => {
    if (firstDiff !== null) {
      cellRefs.current[firstDiff]?.scrollIntoView({ block: 'nearest' });
    }
  }, [firstDiff]);

  // 输入或抄录变化后自动覆盖本地草稿；恢复/损坏提示待决期间暂停写入，
  // 避免空白工作区抢先覆盖待恢复的草稿
  useEffect(() => {
    if (draftPrompt.state !== 'none') return;
    try {
      if (input === '' && cells.length === 0 && transcript === '') {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } else {
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          serializeDraft(createDraft(input, cells, transcript)),
        );
      }
    } catch {
      // 存储不可用时草稿功能静默降级，不影响校样
    }
  }, [input, cells, transcript, draftPrompt]);

  // 恢复草稿：一次性还原三项数据，判定由上面的 useMemo 管线重新计算；
  // 历史以恢复现场为新的起点，不带入上一会话的撤销记录
  const restoreDraft = () => {
    if (draftPrompt.state !== 'restore') return;
    const { draft } = draftPrompt;
    setInput(draft.input);
    setHistory(createHistory(draft.cells));
    setTranscript(draft.transcript);
    setTranscriptError(null);
    setFocusIdx(null);
    setDraftPrompt({ state: 'none' });
  };

  // 放弃草稿：清除缓存，工作区保持空白
  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // 存储不可用时仅关闭提示
    }
    setDraftPrompt({ state: 'none' });
  };

  // 点位切换、添加、插入、删除、清空与成功导入统一经此记录为一步历史
  const applyCellsEdit = (edit: (prev: Cell[]) => Cell[]) =>
    setHistory((prev) => recordEdit(prev, edit(prev.present)));

  // 撤销/重做只移动历史指针；反向解读、首差定位与送厂结论随当前 Cell 数组重算
  const undoTranscript = () => {
    setHistory(undoEdit);
    setFocusIdx(null);
  };

  const redoTranscript = () => {
    setHistory(redoEdit);
    setFocusIdx(null);
  };

  const toggleDot = (index: number, dot: Dot) =>
    applyCellsEdit((prev) => prev.map((c, i) => (i === index ? c ^ dotMask(dot) : c)));

  const addCell = () => {
    applyCellsEdit((prev) => [...prev, 0]);
    setFocusIdx(cells.length);
  };

  const insertCell = (index: number) => {
    applyCellsEdit((prev) => [...prev.slice(0, index), 0, ...prev.slice(index)]);
    setFocusIdx(index);
  };

  const removeCell = (index: number) => {
    const nextLen = cells.length - 1;
    applyCellsEdit((prev) => prev.filter((_, i) => i !== index));
    setFocusIdx(nextLen > 0 ? Math.min(index, nextLen - 1) : null);
  };

  const clearCells = () => {
    applyCellsEdit(() => []);
    setFocusIdx(null);
  };

  // 点位串导入：成功则一次性替换当前抄录并记为一步历史；失败保留原抄录、判定与历史
  const importTranscript = () => {
    const parsed = parseTranscript(transcript);
    if (!parsed.ok) {
      setTranscriptError(parsed.error);
      return;
    }
    applyCellsEdit(() => parsed.cells);
    setFocusIdx(null);
    setTranscriptError(null);
  };

  const onCellKeyDown = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key;
    if (/^[1-6]$/.test(key)) {
      e.preventDefault();
      toggleDot(index, Number(key) as Dot);
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      setFocusIdx(Math.min(index + 1, cells.length - 1));
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIdx(Math.max(index - 1, 0));
    } else if (key === 'Enter') {
      e.preventDefault();
      insertCell(index + 1);
    } else if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      removeCell(index);
    }
  };

  const inputInvalid = !validation.ok && validation.error.kind !== 'empty';

  return (
    <div className="app">
      <header>
        <h1>电梯厅数字房间牌 · 六点盲文校样台</h1>
        <p className="spec">
          点位：左列自上而下 1、2、3，右列 4、5、6 ｜ 数字标志 3456 ｜ 数字 1–0：1、12、14、145、15、124、1245、125、24、245 ｜
          连字符 36 ｜ 斜杠 34 ｜ 空格为空单元
        </p>
      </header>

      {draftPrompt.state !== 'none' && (
        <div
          role={draftPrompt.state === 'corrupt' ? 'alert' : 'status'}
          data-testid="draft-prompt"
          data-state={draftPrompt.state}
          className={`draft-prompt ${draftPrompt.state}`}
        >
          {draftPrompt.state === 'restore' ? (
            <>
              <span>检测到未送厂的本地草稿（{draftSummary(draftPrompt.draft)}），是否恢复？</span>
              <span className="draft-actions">
                <button type="button" data-testid="restore-draft" onClick={restoreDraft}>
                  恢复草稿
                </button>
                <button type="button" data-testid="discard-draft" onClick={discardDraft}>
                  放弃草稿
                </button>
              </span>
            </>
          ) : (
            <>
              <span>
                本地草稿已损坏（{describeDraftError(draftPrompt.error)}），无法恢复；可放弃后从空白开始。
              </span>
              <span className="draft-actions">
                <button type="button" data-testid="discard-draft" onClick={discardDraft}>
                  放弃草稿
                </button>
              </span>
            </>
          )}
        </div>
      )}

      <div role="status" data-testid="verdict" data-state={verdict.state} className={`verdict ${verdict.state}`}>
        {verdict.message}
      </div>

      <main>
        <section className="panel" aria-labelledby="target-title">
          <h2 id="target-title">明眼稿 → 目标单元带</h2>
          <label className="field-label" htmlFor="code-input">
            房间牌代码
          </label>
          <input
            id="code-input"
            data-testid="code-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="如 12-3/4 5"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputInvalid || undefined}
            aria-describedby="code-hint"
          />
          <p id="code-hint" className="hint">
            仅允许数字 0–9、半角连字符 -、斜杠 / 与单个空格；分隔符不得位于首尾或连续出现。
          </p>
          {inputInvalid && !validation.ok && (
            <p role="alert" className="error" data-testid="input-error">
              {describeInputError(validation.error)}
            </p>
          )}
          {target && (
            <>
              <div className="strip" data-testid="target-strip" aria-label="目标单元带">
                {target.map((cell, i) => (
                  <div
                    key={i}
                    className={`cell${firstDiff === i ? ' diff' : ''}`}
                    data-testid={`target-cell-${i}`}
                    data-diff={firstDiff === i || undefined}
                  >
                    <DotGrid cell={cell} />
                    <span className="cell-no">{i + 1}</span>
                  </div>
                ))}
              </div>
              <p className="hint">共 {target.length} 单元</p>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="actual-title">
          <h2 id="actual-title">实物抄录 → 反向解读</h2>
          <div className="toolbar">
            <button type="button" data-testid="add-cell" onClick={addCell}>
              添加单元
            </button>
            <button type="button" data-testid="clear-cells" onClick={clearCells} disabled={cells.length === 0}>
              清空
            </button>
            <button
              type="button"
              data-testid="undo-cells"
              onClick={undoTranscript}
              disabled={!canUndo(history)}
            >
              撤销抄录
            </button>
            <button
              type="button"
              data-testid="redo-cells"
              onClick={redoTranscript}
              disabled={!canRedo(history)}
            >
              重做抄录
            </button>
          </div>
          <p className="hint">
            点击圆点，或聚焦单元后按 1–6 切换点位；←/→ 移动，Enter 插入，Backspace 删除。误操作可用“撤销抄录 / 重做抄录”回退与恢复。
          </p>
          <div className="import-area">
            <label className="field-label" htmlFor="transcript-input">
              点位串导入
            </label>
            <div className="import-row">
              <input
                id="transcript-input"
                data-testid="transcript-input"
                value={transcript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setTranscriptError(null);
                }}
                placeholder="如 3456|1|12|36|3456|14（空白格写作 _）"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={transcriptError !== null || undefined}
                aria-describedby="transcript-hint"
              />
              <button type="button" data-testid="import-transcript" onClick={importTranscript}>
                导入抄录
              </button>
            </div>
            <p id="transcript-hint" className="hint">
              粘贴压点设备复制的竖线分隔点位串，每格为升序不重复的 1–6；导入成功将一次性替换当前抄录，失败则保留原抄录。
            </p>
            {transcriptError && (
              <p role="alert" className="error" data-testid="transcript-error">
                {describeTranscriptError(transcriptError)}
              </p>
            )}
          </div>
          {cells.length === 0 ? (
            <p className="hint">尚无抄录单元，请点击“添加单元”开始抄录。</p>
          ) : (
            <div className="strip" data-testid="actual-strip" aria-label="抄录单元带">
              {cells.map((cell, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    cellRefs.current[i] = el;
                  }}
                  role="group"
                  tabIndex={0}
                  aria-label={`抄录单元 ${i + 1}`}
                  className={`cell editable${firstDiff === i ? ' diff' : ''}`}
                  data-testid={`actual-cell-${i}`}
                  data-diff={firstDiff === i || undefined}
                  onKeyDown={onCellKeyDown(i)}
                  onFocus={() => setFocusIdx(i)}
                >
                  <DotGrid cell={cell} onToggle={(dot) => toggleDot(i, dot)} />
                  <span className="cell-no">{i + 1}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="remove"
                    aria-label={`删除单元 ${i + 1}`}
                    data-testid={`remove-cell-${i}`}
                    onClick={() => removeCell(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <h3 className="decoded-title">反向解读</h3>
          {cells.length === 0 ? (
            <p className="hint">—</p>
          ) : decode.ok ? (
            <output className="decoded-code" data-testid="decoded-code">
              {decode.code}
            </output>
          ) : (
            <p role="alert" className="error" data-testid="decode-error">
              {describeDecodeError(decode.error, decode.index)}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
