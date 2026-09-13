import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  type Cell,
  type Dot,
  compareCells,
  decodeCells,
  describeDecodeError,
  describeInputError,
  dotMask,
  encodeCode,
  validateCode,
} from './braille';
import { DotGrid } from './DotGrid';

type Verdict =
  | { state: 'idle'; message: string }
  | { state: 'input-error'; message: string }
  | { state: 'decode-error'; message: string }
  | { state: 'match'; message: string }
  | { state: 'mismatch'; message: string; firstDiff: number };

export default function App() {
  const [input, setInput] = useState('');
  const [cells, setCells] = useState<Cell[]>([]);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
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

  const toggleDot = (index: number, dot: Dot) =>
    setCells((prev) => prev.map((c, i) => (i === index ? c ^ dotMask(dot) : c)));

  const addCell = () => {
    setCells((prev) => [...prev, 0]);
    setFocusIdx(cells.length);
  };

  const insertCell = (index: number) => {
    setCells((prev) => [...prev.slice(0, index), 0, ...prev.slice(index)]);
    setFocusIdx(index);
  };

  const removeCell = (index: number) => {
    const nextLen = cells.length - 1;
    setCells((prev) => prev.filter((_, i) => i !== index));
    setFocusIdx(nextLen > 0 ? Math.min(index, nextLen - 1) : null);
  };

  const clearCells = () => {
    setCells([]);
    setFocusIdx(null);
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
          </div>
          <p className="hint">点击圆点，或聚焦单元后按 1–6 切换点位；←/→ 移动，Enter 插入，Backspace 删除。</p>
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
