import { describe, expect, it } from 'vitest';
import {
  CELL_MASK_MAX,
  DRAFT_SCHEMA,
  DRAFT_VERSION,
  createDraft,
  describeDraftError,
  parseDraft,
  serializeDraft,
} from '../src/draft';
import {
  DIGIT_CELLS,
  NUMBER_SIGN,
  cellOf,
  compareCells,
  decodeCells,
  encodeCode,
  validateCode,
} from '../src/braille';

const D = (digit: string) => DIGIT_CELLS[digit];

describe('本地草稿：往返', () => {
  it('完整现场序列化后原样还原', () => {
    const draft = createDraft('12-3/4 5', encodeCode('12-3/4 5'), '3456|1|12|36');
    expect(parseDraft(serializeDraft(draft))).toEqual({ ok: true, draft });
  });

  it('空白现场与空单元带也可往返', () => {
    const draft = createDraft('', [], '');
    expect(parseDraft(serializeDraft(draft))).toEqual({ ok: true, draft });
  });

  it('单元取遍六点位掩码边界：0（空单元）与 63（全六点）', () => {
    const draft = createDraft('1', [0, CELL_MASK_MAX, NUMBER_SIGN], '_|123456');
    expect(parseDraft(serializeDraft(draft))).toEqual({ ok: true, draft });
  });

  it('createDraft 复制抄录数组，后续修改原数组不影响草稿', () => {
    const cells = [NUMBER_SIGN, D('1')];
    const draft = createDraft('1', cells, '');
    cells.push(D('2'));
    expect(draft.cells).toEqual([NUMBER_SIGN, D('1')]);
  });

  it('草稿带模式标识与版本', () => {
    const raw = JSON.parse(serializeDraft(createDraft('1', [], '')));
    expect(raw.schema).toBe(DRAFT_SCHEMA);
    expect(raw.version).toBe(DRAFT_VERSION);
  });
});

describe('本地草稿：恢复数据进入现有管线重算', () => {
  it('往返后的明眼稿与抄录可直接经 validateCode / decodeCells / compareCells 重算首差', () => {
    // 不一致现场：目标 12，抄录末单元多点 5（12 → 18）
    const draft = createDraft('12', [NUMBER_SIGN, D('1'), D('8')], '3456|1|125');
    const parsed = parseDraft(serializeDraft(draft));
    if (!parsed.ok) throw new Error('应解析成功');

    // 草稿只含原始数据，判定结果由现有规则重新计算而非持久化
    expect(validateCode(parsed.draft.input)).toEqual({ ok: true });
    expect(decodeCells(parsed.draft.cells)).toEqual({ ok: true, code: '18' });
    expect(compareCells(encodeCode(parsed.draft.input), parsed.draft.cells)).toEqual({
      status: 'mismatch',
      firstDiff: 2,
    });
  });

  it('往返后的一致现场重算为可送厂', () => {
    const draft = createDraft('7-8', encodeCode('7-8'), '');
    const parsed = parseDraft(serializeDraft(draft));
    if (!parsed.ok) throw new Error('应解析成功');
    expect(decodeCells(parsed.draft.cells)).toEqual({ ok: true, code: '7-8' });
    expect(compareCells(encodeCode(parsed.draft.input), parsed.draft.cells)).toEqual({
      status: 'match',
    });
  });
});

describe('本地草稿：拒绝损坏数据', () => {
  it.each(['', 'not-json', '{broken', '3456|1|12'])('无法解析的内容：%s', (raw) => {
    const r = parseDraft(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-json');
  });

  it.each(['123', '"text"', 'true', 'null', '[1,2,3]'])('非草稿对象：%s', (raw) => {
    const r = parseDraft(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not-object');
  });

  it('模式标识不匹配或缺失', () => {
    for (const schema of ['other-app/draft', 1, null]) {
      const r = parseDraft(JSON.stringify({ schema, version: 1, input: '', cells: [], transcript: '' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('bad-schema');
    }
    const missing = parseDraft(JSON.stringify({ version: 1, input: '', cells: [], transcript: '' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe('bad-schema');
  });

  it('版本不受支持', () => {
    for (const version of [0, 2, '1']) {
      const r = parseDraft(
        JSON.stringify({ schema: DRAFT_SCHEMA, version, input: '', cells: [], transcript: '' }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('bad-version');
    }
  });

  it('明眼稿与点位串必须是字符串', () => {
    const base = { schema: DRAFT_SCHEMA, version: DRAFT_VERSION, input: '', cells: [], transcript: '' };
    const badInput = parseDraft(JSON.stringify({ ...base, input: 12 }));
    expect(badInput).toEqual({ ok: false, error: { kind: 'bad-field', field: 'input' } });
    const badTranscript = parseDraft(JSON.stringify({ ...base, transcript: null }));
    expect(badTranscript).toEqual({ ok: false, error: { kind: 'bad-field', field: 'transcript' } });
  });

  it('抄录必须是数组', () => {
    const r = parseDraft(
      JSON.stringify({ schema: DRAFT_SCHEMA, version: 1, input: '', cells: '3456', transcript: '' }),
    );
    expect(r).toEqual({ ok: false, error: { kind: 'bad-field', field: 'cells' } });
  });

  it('单元值超出六点位掩码：越界、负值、非整数、非数字类型', () => {
    const base = { schema: DRAFT_SCHEMA, version: DRAFT_VERSION, input: '', transcript: '' };
    const cases: Array<{ cells: unknown[]; index: number }> = [
      { cells: [NUMBER_SIGN, 64], index: 1 }, // 超出 0b111111
      { cells: [999], index: 0 },
      { cells: [-1], index: 0 },
      { cells: [1.5], index: 0 },
      { cells: ['12'], index: 0 },
      { cells: [null], index: 0 },
      { cells: [cellOf([1]), {}, cellOf([2])], index: 1 },
    ];
    for (const { cells, index } of cases) {
      const r = parseDraft(JSON.stringify({ ...base, cells }));
      expect(r, JSON.stringify(cells)).toEqual({ ok: false, error: { kind: 'bad-cell', index } });
    }
  });

  it('损坏草稿整体拒绝，不返回部分可用数据', () => {
    // 明眼稿合法、但第 2 单元越界：整个草稿判损坏
    const r = parseDraft(
      JSON.stringify({
        schema: DRAFT_SCHEMA,
        version: DRAFT_VERSION,
        input: '12',
        cells: [NUMBER_SIGN, 64],
        transcript: '',
      }),
    );
    expect(r.ok).toBe(false);
    expect(r).not.toMatchObject({ draft: expect.anything() });
  });
});

describe('本地草稿：错误文案', () => {
  it('指出损坏原因', () => {
    expect(describeDraftError({ kind: 'not-json' })).toContain('无法解析');
    expect(describeDraftError({ kind: 'not-object' })).toContain('不是草稿对象');
    expect(describeDraftError({ kind: 'bad-schema' })).toContain('模式标识');
    expect(describeDraftError({ kind: 'bad-version' })).toContain('版本');
    expect(describeDraftError({ kind: 'bad-field', field: 'cells' })).toContain('cells');
    expect(describeDraftError({ kind: 'bad-cell', index: 1 })).toContain('第 2 单元');
    expect(describeDraftError({ kind: 'bad-cell', index: 1 })).toContain('六点位掩码');
  });
});
