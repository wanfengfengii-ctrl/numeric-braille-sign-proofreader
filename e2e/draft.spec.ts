import { expect, test, type Page } from '@playwright/test';

/** 与 src/draft.ts 对应的本地草稿存储键（测试内独立书写） */
const DRAFT_KEY = 'braille-proofing-station/draft/v1';

/** 代码 12 的点位串；末格多点 5 时抄录为 18，首差位于第 3 单元 */
const TRANSCRIPT_12 = '3456|1|12';
const TRANSCRIPT_18 = '3456|1|125';

async function importTranscript(page: Page, transcript: string) {
  await page.getByTestId('transcript-input').fill(transcript);
  await page.getByTestId('import-transcript').click();
}

/** 等自动保存落盘，避免刷新时草稿尚未写入 */
async function waitDraftSaved(page: Page) {
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY))
    .toBe(true);
}

test('本地草稿：无草稿时保持原有启动体验', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('draft-prompt')).toBeHidden();
  await expect(page.getByTestId('code-input')).toHaveValue('');
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('verdict')).toContainText('等待输入房间牌代码');
});

test('本地草稿：刷新后恢复不一致现场，判定由现有规则重算', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_18);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await waitDraftSaved(page);

  await page.reload();

  // 再次打开时提示恢复；恢复前工作区保持空白，不被草稿数据污染
  const prompt = page.getByTestId('draft-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('未送厂');
  await expect(prompt).toContainText('12');
  await expect(page.getByTestId('code-input')).toHaveValue('');
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();

  await page.getByTestId('restore-draft').click();

  // 一次性还原明眼稿、抄录单元与点位串输入
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId('code-input')).toHaveValue('12');
  await expect(page.getByTestId('transcript-input')).toHaveValue(TRANSCRIPT_18);
  await expect(page.getByTestId('actual-cell-2')).toBeVisible();
  await expect(page.getByTestId('actual-cell-3')).toBeHidden();

  // 反向解读、首差定位与送厂结论由现有规则重新计算（草稿不含判定结果）
  await expect(page.getByTestId('decoded-code')).toHaveText('18');
  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await expect(verdict).toContainText('第 3 单元');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');
  await expect(page.getByTestId('target-cell-2')).toHaveAttribute('data-diff', 'true');
});

test('本地草稿：放弃草稿后从空白开始，再次打开不再提示', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('7-8');
  await page.getByTestId('add-cell').click();
  await page.keyboard.press('3');
  await waitDraftSaved(page);

  await page.reload();
  await expect(page.getByTestId('draft-prompt')).toBeVisible();

  await page.getByTestId('discard-draft').click();

  // 从空白开始：输入、抄录与判定全部清空
  await expect(page.getByTestId('draft-prompt')).toBeHidden();
  await expect(page.getByTestId('code-input')).toHaveValue('');
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('verdict')).toContainText('等待输入房间牌代码');

  // 草稿已清除：再次刷新不再提示
  await page.reload();
  await expect(page.getByTestId('draft-prompt')).toBeHidden();
  await expect(page.getByTestId('code-input')).toHaveValue('');
});

test('本地草稿：坏缓存提示已损坏，放弃后正常编辑并覆盖', async ({ page }) => {
  await page.goto('/');

  // 单元值超出六点位掩码（合法范围 0–63）
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        schema: 'braille-proofing-station/draft',
        version: 1,
        input: '12',
        cells: [60, 999],
        transcript: '',
      }),
    );
  }, DRAFT_KEY);
  await page.reload();

  const prompt = page.getByTestId('draft-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('已损坏');
  await expect(prompt).toContainText('六点位掩码');
  // 损坏草稿不提供恢复入口
  await expect(page.getByTestId('restore-draft')).toBeHidden();
  // 空白工作区不被部分数据污染
  await expect(page.getByTestId('code-input')).toHaveValue('');
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();

  // 无法解析的内容同样视为损坏
  await page.evaluate((key) => localStorage.setItem(key, 'not-json{'), DRAFT_KEY);
  await page.reload();
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('已损坏');
  await expect(prompt).toContainText('无法解析');

  await page.getByTestId('discard-draft').click();
  await expect(prompt).toBeHidden();

  // 放弃后从空白开始，现有导入流程照常可用
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await waitDraftSaved(page);

  // 正常编辑产生的新草稿覆盖了坏缓存：刷新后提示恢复而非损坏
  await page.reload();
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('是否恢复');
  await expect(prompt).not.toContainText('已损坏');
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('decoded-code')).toHaveText('12');
});

test('本地草稿：恢复后修正首差直至一致，修正结果随草稿保存', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_18);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await waitDraftSaved(page);

  await page.reload();
  await page.getByTestId('restore-draft').click();
  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');

  // 指针修正：关掉第 3 单元多出的点 5
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(verdict).toHaveAttribute('data-state', 'match');
  await expect(verdict).toContainText('房间牌一致');

  // 键盘操作照常：聚焦第 2 单元按 4 加点判不一致，再按 4 复原
  await page.getByTestId('actual-cell-1').focus();
  await page.keyboard.press('4');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await page.keyboard.press('4');
  await expect(verdict).toHaveAttribute('data-state', 'match');
  await waitDraftSaved(page);

  // 修正后的现场已覆盖草稿：再次刷新恢复即为一致
  await page.reload();
  await page.getByTestId('restore-draft').click();
  await expect(verdict).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('decoded-code')).toHaveText('12');
});
