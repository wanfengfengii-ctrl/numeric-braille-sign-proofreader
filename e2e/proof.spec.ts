import { expect, test, type Page } from '@playwright/test';

/** 与 src/braille.ts 对应的点位（测试内独立书写，避免与实现互相掩盖错误） */
const SIGN = [3, 4, 5, 6];
const DIGIT: Record<string, number[]> = {
  '1': [1],
  '2': [1, 2],
  '3': [1, 4],
  '4': [1, 4, 5],
  '5': [1, 5],
  '6': [1, 2, 4],
  '7': [1, 2, 4, 5],
  '8': [1, 2, 5],
  '9': [2, 4],
  '0': [2, 4, 5],
};
const HYPHEN = [3, 6];
const SLASH = [3, 4];
const SPACE: number[] = [];

/** 键盘路径：添加单元后按 1–6 切换点位 */
async function transcribeWithKeyboard(page: Page, cells: number[][]) {
  for (const dots of cells) {
    await page.getByTestId('add-cell').click();
    for (const d of dots) await page.keyboard.press(String(d));
  }
}

/** 指针路径：逐点点击 */
async function transcribeWithPointer(page: Page, cells: number[][]) {
  for (let i = 0; i < cells.length; i++) {
    await page.getByTestId('add-cell').click();
    for (const d of cells[i]) {
      await page.getByTestId(`actual-cell-${i}`).locator(`[data-dot="${d}"]`).click();
    }
  }
}

test('单段数字：编码为目标单元带，键盘抄录后判定一致', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('5');

  // 目标单元带：数字标志 + 数字 5
  await expect(page.getByTestId('target-cell-0')).toBeVisible();
  await expect(page.getByTestId('target-cell-1')).toBeVisible();
  await expect(page.getByTestId('target-cell-2')).toBeHidden();

  await transcribeWithKeyboard(page, [SIGN, DIGIT['5']]);

  await expect(page.getByTestId('decoded-code')).toHaveText('5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('verdict')).toContainText('一致');
});

test('多段代码：指针逐点抄录后判定一致并反向显示代码', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12-3/4 5');

  await transcribeWithPointer(page, [
    SIGN, DIGIT['1'], DIGIT['2'], HYPHEN,
    SIGN, DIGIT['3'], SLASH,
    SIGN, DIGIT['4'], SPACE,
    SIGN, DIGIT['5'],
  ]);

  await expect(page.getByTestId('decoded-code')).toHaveText('12-3/4 5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('verdict')).toContainText('房间牌一致');
});

test('漏加数字标志：报错、不猜测字符并清除旧的一致结果', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');
  await transcribeWithKeyboard(page, [SIGN, DIGIT['1'], DIGIT['2']]);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 删掉数字标志单元，模拟漏加
  await page.getByTestId('remove-cell-0').click();

  await expect(page.getByTestId('decode-error')).toContainText('缺少数字标志');
  await expect(page.getByTestId('decode-error')).toContainText('第 1 单元');
  await expect(page.getByTestId('decoded-code')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');
  await expect(page.getByTestId('verdict')).not.toContainText('房间牌一致');
});

test('点位差异：判不一致并聚焦首个错误单元，返工后恢复一致', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');

  // 末单元多点 5：12 → 8
  await transcribeWithKeyboard(page, [SIGN, DIGIT['1'], DIGIT['8']]);

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await expect(verdict).toContainText('第 3 单元');
  await expect(verdict).toContainText('点位不同');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');
  await expect(page.getByTestId('target-cell-2')).toHaveAttribute('data-diff', 'true');

  // 返工：关掉多出的点 5
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(verdict).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('actual-cell-2')).not.toHaveAttribute('data-diff', 'true');

  // 单元数量不同同样判不一致
  await page.getByTestId('remove-cell-2').click();
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await expect(verdict).toContainText('第 3 单元');
  await expect(verdict).toContainText('缺少');
});

test('非法输入：表外字符与分隔符规则，清除旧的一致结果', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('7');
  await transcribeWithKeyboard(page, [SIGN, DIGIT['7']]);
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');

  // 表外字符
  await page.getByTestId('code-input').fill('7A');
  await expect(page.getByTestId('input-error')).toContainText('表外字符');
  await expect(page.getByTestId('target-strip')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'input-error');
  await expect(page.getByTestId('verdict')).not.toContainText('房间牌一致');

  // 分隔符连续出现
  await page.getByTestId('code-input').fill('1--2');
  await expect(page.getByTestId('input-error')).toContainText('不得连续');

  // 分隔符位于首尾
  await page.getByTestId('code-input').fill(' 12');
  await expect(page.getByTestId('input-error')).toContainText('首尾');

  // 全角数字同属表外字符
  await page.getByTestId('code-input').fill('１２');
  await expect(page.getByTestId('input-error')).toContainText('表外字符');
});

test('重复数字标志与未知点阵：不猜测字符', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('1');

  await transcribeWithKeyboard(page, [SIGN, SIGN, DIGIT['1']]);
  await expect(page.getByTestId('decode-error')).toContainText('数字标志重复');
  await expect(page.getByTestId('decode-error')).toContainText('第 2 单元');
  await expect(page.getByTestId('decoded-code')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');

  // 未知点阵：仅点 6
  await page.getByTestId('clear-cells').click();
  await transcribeWithKeyboard(page, [SIGN, DIGIT['1'], [6]]);
  await expect(page.getByTestId('decode-error')).toContainText('未知点阵');
  await expect(page.getByTestId('decode-error')).toContainText('第 3 单元');
  await expect(page.getByTestId('decoded-code')).toBeHidden();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'decode-error');
});
