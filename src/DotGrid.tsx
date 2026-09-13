import { type Cell, type Dot, cellHas } from './braille';

/** 行的视觉排布：左列 1、2、3，右列 4、5、6 */
const ROWS: readonly (readonly [Dot, Dot])[] = [
  [1, 4],
  [2, 5],
  [3, 6],
];

interface DotGridProps {
  cell: Cell;
  /** 提供时点位可点击切换（抄录侧），否则为只读（目标侧） */
  onToggle?: (dot: Dot) => void;
}

export function DotGrid({ cell, onToggle }: DotGridProps) {
  return (
    <span className="dot-grid">
      {ROWS.flatMap((row) =>
        row.map((dot) => {
          const on = cellHas(cell, dot);
          if (onToggle) {
            return (
              <button
                key={dot}
                type="button"
                tabIndex={-1}
                className="dot"
                data-dot={dot}
                data-on={on || undefined}
                aria-pressed={on}
                aria-label={`点 ${dot}`}
                onClick={() => onToggle(dot)}
              />
            );
          }
          return (
            <span
              key={dot}
              className="dot"
              data-dot={dot}
              data-on={on || undefined}
              aria-hidden="true"
            />
          );
        }),
      )}
    </span>
  );
}
