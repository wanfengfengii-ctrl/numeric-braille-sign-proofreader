import { expect, test, type Page } from '@playwright/test';

/** 与 src/braille.ts 对应的点位（测试内独立书写，避免与实现互相掩盖错误） */
const SIGN = [3, 4, 5, 6];

/** 代码 12 的点位串；末格多点 5 时抄录为 18，首差位于第 3 单元 */
const TRANSCRIPT_12 = '3456|1|12';
const TRANSCRIPT_12_3_4_5 = '3456|1|12|36|3456|14|34|3456|145|_|3456|15';

/** 与 src/draft.ts 对应的本地草稿存储键（测试内独立书写） */
const DRAFT_KEY = 'braille-proofing-station/draft/v1';

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

test('抄录历史：误切点位、删错单元、清空抄录后撤销至一致', async ({ page }) => {
  await page.goto('/');

  // 历史边界：无任何编辑时撤销/重做均不可用
  await expect(page.getByTestId('undo-cells')).toBeDisabled();
  await expect(page.getByTestId('redo-cells')).toBeDisabled();

  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('undo-cells')).toBeEnabled();
  await expect(page.getByTestId('redo-cells')).toBeDisabled();

  // 误切点位：末单元多点 5，12 → 18
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('decoded-code')).toHaveText('12');

  // 删错单元：删掉数字标志，反向解读报错
  await page.getByTestId('remove-cell-0').click();
  await expect(page.getByTestId('decode-error')).toContainText('缺少数字标志');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-2')).toBeVisible();
  await expect(page.getByTestId('decoded-code')).toHaveText('12');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 清空整条抄录后撤销：现场与判定一并恢复
  await page.getByTestId('clear-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'idle');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-2')).toBeVisible();
  await expect(page.getByTestId('decoded-code')).toHaveText('12');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 重做恢复刚撤销的清空；再撤销回到一致现场
  await page.getByTestId('redo-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'idle');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
});

test('抄录历史：成功导入的整体撤销，失败导入不改变历史', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12-3/4 5');

  // 先手工抄录一格数字标志（数字段不完整，判定报错）
  await page.getByTestId('add-cell').click();
  for (const d of SIGN) await page.keyboard.press(String(d));
  await expect(page.getByTestId('actual-cell-0')).toBeVisible();
  await expect(page.getByTestId('actual-cell-1')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');

  // 一次导入 12 格点位串，判定一致
  await importTranscript(page, TRANSCRIPT_12_3_4_5);
  await expect(page.getByTestId('actual-cell-11')).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 整体撤销：一次点击即回到导入前的单格现场，而非逐格回退
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeVisible();
  await expect(page.getByTestId('actual-cell-1')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');

  // 重做恢复整条导入带
  await page.getByTestId('redo-cells').click();
  await expect(page.getByTestId('actual-cell-11')).toBeVisible();
  await expect(page.getByTestId('decoded-code')).toHaveText('12-3/4 5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 失败导入：界面指出错误，现场与判定不变
  await importTranscript(page, '3456|17|12');
  await expect(page.getByTestId('transcript-error')).toContainText('越界点');
  await expect(page.getByTestId('actual-cell-11')).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 失败导入不产生历史步骤：撤销仍一步回到成功导入前的单格现场
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeVisible();
  await expect(page.getByTestId('actual-cell-1')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');
});

test('抄录历史：撤销后产生新编辑时无法重做', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 误切点位后撤销：重做分支出现
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('redo-cells')).toBeEnabled();

  // 撤销后产生新编辑：重做分支被丢弃，按钮禁用
  // （末尾追加的空单元相当于末尾空格分隔符，反向解读报结构非法）
  await page.getByTestId('add-cell').click();
  await expect(page.getByTestId('redo-cells')).toBeDisabled();
  await expect(page.getByTestId('actual-cell-3')).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');

  // 新分支自身照常撤销：回到新编辑前的一致现场
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-3')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
});

test('抄录历史：再次导入与当前现场相同的点位串不产生空步骤', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('undo-cells')).toBeEnabled();
  await expect(page.getByTestId('redo-cells')).toBeDisabled();

  // 房间牌已有完整抄录时再次导入相同点位串：现场毫无变化
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('actual-cell-2')).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 不推进有效编辑历史：一次撤销即回到导入前的空现场，
  // 而非先撤销一个“撤销后现场毫无变化”的空步骤
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('undo-cells')).toBeDisabled();
});

test('抄录历史：撤销后导入与当前现场相同的点位串保留重做分支', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12-3/4 5');

  // 先手工抄录一格数字标志，再一次性导入完整点位串
  await page.getByTestId('add-cell').click();
  for (const d of SIGN) await page.keyboard.press(String(d));
  await importTranscript(page, TRANSCRIPT_12_3_4_5);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 撤销抄录：现场回到导入前的单格，重做分支出现
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('actual-cell-0')).toBeVisible();
  await expect(page.getByTestId('actual-cell-1')).toBeHidden();
  await expect(page.getByTestId('redo-cells')).toBeEnabled();

  // 导入与当前现场完全相同的点位串（仅一格数字标志）：抄录内容不变，
  // 原有重做机会必须保留
  await importTranscript(page, '3456');
  await expect(page.getByTestId('actual-cell-0')).toBeVisible();
  await expect(page.getByTestId('actual-cell-1')).toBeHidden();
  await expect(page.getByTestId('transcript-error')).toBeHidden();
  await expect(page.getByTestId('redo-cells')).toBeEnabled();

  // 可恢复分支内容不变：重做仍恢复整条导入带
  await page.getByTestId('redo-cells').click();
  await expect(page.getByTestId('actual-cell-11')).toBeVisible();
  await expect(page.getByTestId('decoded-code')).toHaveText('12-3/4 5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
});

test('抄录历史：撤销后出现首个差异单元时键盘焦点直接落到该格', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');

  // 导入末格多点 5 的抄录：首差在第 3 单元
  await importTranscript(page, '3456|1|125');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');

  // 指针修正为一致（焦点在点位按钮上），再撤销回到差异现场
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await page.getByTestId('undo-cells').click();

  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');
  // 不只滚动高亮：键盘焦点直接落到首个差异单元，可立即按 5 返工
  await expect(page.getByTestId('actual-cell-2')).toBeFocused();
  await page.keyboard.press('5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
});

test('抄录历史：重做后出现首个差异单元时键盘焦点直接落到该格', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 制造差异后撤销回一致：重做将重新进入差异现场
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  await page.getByTestId('redo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');
  await expect(page.getByTestId('actual-cell-2')).toBeFocused();
});

test('抄录历史：刷新恢复草稿后没有旧会话历史', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await importTranscript(page, TRANSCRIPT_12);

  // 制造更多历史：末单元多点 5，判不一致
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('undo-cells')).toBeEnabled();
  await waitDraftSaved(page);

  // 刷新并恢复草稿：判定由现有规则重算，但旧会话的撤销历史不带入
  await page.reload();
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('decoded-code')).toHaveText('18');
  await expect(page.getByTestId('undo-cells')).toBeDisabled();
  await expect(page.getByTestId('redo-cells')).toBeDisabled();

  // 恢复后新编辑照常记录历史：关掉多出的点 5 判定一致，且可撤销
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('undo-cells')).toBeEnabled();
  await page.getByTestId('undo-cells').click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'mismatch');
});
