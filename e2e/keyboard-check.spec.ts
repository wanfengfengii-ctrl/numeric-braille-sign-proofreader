import { expect, test, type Page } from '@playwright/test';

/** 与 src/draft.ts 对应的本地草稿存储键（测试内独立书写） */
const DRAFT_KEY = 'braille-proofing-station/draft/v1';

const TRANSCRIPT_18 = '3456|1|125';

async function openCheck(page: Page) {
  await page.getByTestId('start-keycheck').click();
  const dialog = page.getByTestId('keycheck-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-state', 'checking');
  await expect(page.getByTestId('keycheck-expected')).toContainText('1');
  return dialog;
}

/** 在 window 上派发长按自动重复事件（KeyboardEvent.repeat=true） */
async function dispatchRepeats(page: Page, key: string, times = 3) {
  await page.evaluate(
    ({ key, times }) => {
      for (let i = 0; i < times; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true }));
      }
    },
    { key, times },
  );
}

/** 抓取校样现场快照：检查前后必须完全一致 */
async function snapshotScene(page: Page) {
  return page.evaluate((draftKey) => {
    const text = (sel: string) => document.querySelector(sel)?.textContent ?? null;
    const actual = [...document.querySelectorAll('[data-testid^="actual-cell-"]')].map((cell) =>
      [...cell.querySelectorAll('.dot[data-dot]')].map((dot) => ({
        dot: dot.getAttribute('data-dot'),
        on: dot.hasAttribute('data-on'),
      })),
    );
    return {
      input: (document.querySelector('[data-testid="code-input"]') as HTMLInputElement).value,
      transcript: (document.querySelector('[data-testid="transcript-input"]') as HTMLInputElement).value,
      verdictState: document.querySelector('[data-testid="verdict"]')?.getAttribute('data-state'),
      verdictText: text('[data-testid="verdict"]'),
      decoded: text('[data-testid="decoded-code"]'),
      targetCount: document.querySelectorAll('[data-testid^="target-cell-"]').length,
      actual,
      undoDisabled: (document.querySelector('[data-testid="undo-cells"]') as HTMLButtonElement).disabled,
      redoDisabled: (document.querySelector('[data-testid="redo-cells"]') as HTMLButtonElement).disabled,
      draft: localStorage.getItem(draftKey),
    };
  }, DRAFT_KEY);
}

test('按键检查：依次按下 1 至 6 完整通过，长按连发不计入', async ({ page }) => {
  await page.goto('/');
  const dialog = await openCheck(page);

  // 长按连发（含错序点位与非点位键的自动重复）一律忽略，检查继续等待点位 1
  await dispatchRepeats(page, '3', 4);
  await dispatchRepeats(page, 'a', 2);
  await expect(page.getByTestId('keycheck-expected')).toContainText('1');
  await expect(dialog).toHaveAttribute('data-state', 'checking');

  for (const dot of [1, 2, 3, 4, 5]) {
    await page.keyboard.press(String(dot));
    await expect(page.getByTestId('keycheck-expected')).toContainText(String(dot + 1));
  }
  await page.keyboard.press('6');

  // 通过页：状态、本轮确认记录 1–6
  await expect(dialog).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('keycheck-expected')).toBeHidden();
  const confirmed = page.getByTestId('keycheck-confirmed');
  await expect(confirmed).toContainText('1、2、3、4、5、6');
  await expect(confirmed).toContainText('6/6');
  const record = dialog.locator('[data-state="confirmed"]');
  await expect(record).toHaveCount(6);

  // 失败入口在通过页不存在；通过页提供“返回校样台”
  await expect(page.getByTestId('keycheck-retry')).toHaveCount(0);
  await page.getByTestId('keycheck-finish').click();
  await expect(dialog).toBeHidden();
});

test('按键检查：错序立即失败，明确显示期望键与实际键，重新检查为全新会话后可通过', async ({ page }) => {
  await page.goto('/');
  const dialog = await openCheck(page);

  // 先确认点位 1，随后期望 2 时按下 5：顺序错误
  await page.keyboard.press('1');
  await expect(page.getByTestId('keycheck-expected')).toContainText('2');
  await page.keyboard.press('5');

  await expect(dialog).toHaveAttribute('data-state', 'failed');
  const reason = page.getByTestId('keycheck-failure');
  await expect(reason).toContainText('期望按下点位 2');
  await expect(reason).toContainText('实际按下点位 5');
  await expect(reason).toContainText('顺序错误');
  // 已确认记录保留到失败时刻
  await expect(dialog).toContainText('已确认：1');

  // 失败页只提供“重新检查”：没有返回/完成出口
  await expect(page.getByTestId('keycheck-retry')).toBeVisible();
  await expect(page.getByTestId('keycheck-finish')).toHaveCount(0);
  await expect(page.getByTestId('keycheck-expected')).toBeHidden();

  await page.getByTestId('keycheck-retry').click();

  // 全新会话：确认记录清零、重新从点位 1 开始
  await expect(dialog).toHaveAttribute('data-state', 'checking');
  await expect(page.getByTestId('keycheck-expected')).toContainText('1');
  await expect(dialog).toContainText('已确认：无');

  for (const dot of [1, 2, 3, 4, 5, 6]) await page.keyboard.press(String(dot));
  await expect(dialog).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('keycheck-confirmed')).toContainText('1、2、3、4、5、6');
});

test('按键检查：非点位键立即失败并显示实际原因', async ({ page }) => {
  await page.goto('/');
  const dialog = await openCheck(page);
  await page.keyboard.press('a');
  await expect(dialog).toHaveAttribute('data-state', 'failed');
  const reason = page.getByTestId('keycheck-failure');
  await expect(reason).toContainText('期望按下点位 1');
  await expect(reason).toContainText('非点位键');
  await expect(reason).toContainText('a');
});

test('按键检查：检查中窗口失焦立即失败并记录期望点位', async ({ page }) => {
  await page.goto('/');
  const dialog = await openCheck(page);
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await expect(page.getByTestId('keycheck-expected')).toContainText('3');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));

  await expect(dialog).toHaveAttribute('data-state', 'failed');
  const reason = page.getByTestId('keycheck-failure');
  await expect(reason).toContainText('期望按下点位 3');
  await expect(reason).toContainText('失焦');

  // 失焦失败同样只能重新检查，且新一轮可通过
  await page.getByTestId('keycheck-retry').click();
  await expect(dialog).toHaveAttribute('data-state', 'checking');
  for (const dot of [1, 2, 3, 4, 5, 6]) await page.keyboard.press(String(dot));
  await expect(dialog).toHaveAttribute('data-state', 'passed');
});

test('按键检查：检查前后校样现场（明眼稿、Cell 数组、导入文本、判定、草稿）完全一致', async ({ page }) => {
  await page.goto('/');
  // 构造一个不一致现场：代码 12，抄录解读为 18，首差在第 3 单元
  await page.getByTestId('code-input').fill('12');
  await page.getByTestId('transcript-input').fill(TRANSCRIPT_18);
  await page.getByTestId('import-transcript').click();
  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  // 聚焦一个抄录单元：检查中的 1–6 绝不能切换它的点位
  await page.getByTestId('actual-cell-2').focus();

  const before = await snapshotScene(page);
  expect(before.verdictState).toBe('mismatch');
  expect(before.actual).toHaveLength(3);
  expect(before.draft).not.toBeNull();

  // 第一轮：完整通过后返回
  const dialog = await openCheck(page);
  for (const dot of [1, 2, 3, 4, 5, 6]) await page.keyboard.press(String(dot));
  await expect(dialog).toHaveAttribute('data-state', 'passed');
  await page.getByTestId('keycheck-finish').click();
  await expect(dialog).toBeHidden();

  const afterPass = await snapshotScene(page);
  expect(afterPass).toEqual(before);

  // 第二轮：错序失败 → 重新检查 → 通过 → 返回；检查过程不改动任何现场数据
  await page.getByTestId('start-keycheck').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('4'); // 期望 2，错序
  await expect(dialog).toHaveAttribute('data-state', 'failed');
  await page.getByTestId('keycheck-retry').click();
  // 重试过程中夹杂非点位键与失焦以外的错键会直接失败，这里严格按 1–6 通过
  for (const dot of [1, 2, 3, 4, 5, 6]) await page.keyboard.press(String(dot));
  await expect(dialog).toHaveAttribute('data-state', 'passed');
  await page.getByTestId('keycheck-finish').click();
  await expect(dialog).toBeHidden();

  const afterRetry = await snapshotScene(page);
  expect(afterRetry).toEqual(before);

  // 现场仍可继续正常抄录与判定，键盘操作照常生效
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(verdict).toHaveAttribute('data-state', 'match');
});
