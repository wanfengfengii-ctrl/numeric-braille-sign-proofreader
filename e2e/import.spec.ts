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

/** 代码 12-3/4 5 对应的竖线分隔点位串：数字段、连字符、斜杠与空白格 */
const TRANSCRIPT_12_3_4_5 = '3456|1|12|36|3456|14|34|3456|145|_|3456|15';

async function importTranscript(page: Page, transcript: string) {
  await page.getByTestId('transcript-input').fill(transcript);
  await page.getByTestId('import-transcript').click();
}

test('点位串导入：含数字段、分隔符与空白格，一次性替换抄录并判定一致', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12-3/4 5');

  await importTranscript(page, TRANSCRIPT_12_3_4_5);

  // 12 个抄录单元一次到位，无需逐格点按
  await expect(page.getByTestId('actual-cell-11')).toBeVisible();
  await expect(page.getByTestId('actual-cell-12')).toBeHidden();
  // 反向解读、送厂结论随导入刷新
  await expect(page.getByTestId('decoded-code')).toHaveText('12-3/4 5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('verdict')).toContainText('房间牌一致');
  await expect(page.getByTestId('transcript-error')).toBeHidden();
});

test('点位串导入：失败时指出第几个文本格及原因，保留导入前的抄录与判定', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');

  // 先导入一份正确抄录并确认一致
  await importTranscript(page, '3456|1|12');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('decoded-code')).toHaveText('12');

  // 越界点：第 2 文本格含 7
  await importTranscript(page, '3456|17|12');
  const error = page.getByTestId('transcript-error');
  await expect(error).toContainText('第 2 文本格');
  await expect(error).toContainText('越界点');

  // 乱序：第 2 文本格 21
  await importTranscript(page, '3456|21');
  await expect(error).toContainText('第 2 文本格');
  await expect(error).toContainText('乱序');

  // 重复点：第 2 文本格 11
  await importTranscript(page, '3456|11');
  await expect(error).toContainText('第 2 文本格');
  await expect(error).toContainText('重复');

  // 缺失内容：竖线形成空格段
  await importTranscript(page, '3456||12');
  await expect(error).toContainText('第 2 文本格');
  await expect(error).toContainText('缺失内容');

  // 首尾竖线同样属于缺失内容
  await importTranscript(page, '|3456|1|12');
  await expect(error).toContainText('第 1 文本格');

  // 全程未覆盖已核对数据：抄录单元、反向解读与送厂结论保持导入前状态
  await expect(page.getByTestId('actual-cell-2')).toBeVisible();
  await expect(page.getByTestId('actual-cell-3')).toBeHidden();
  await expect(page.getByTestId('decoded-code')).toHaveText('12');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('verdict')).toContainText('房间牌一致');
});

test('点位串导入：导入后仍可用键盘、指针、插入与删除修正', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('12');

  // 末格多点 5：12 → 18，首差定位于第 3 单元
  await importTranscript(page, '3456|1|125');
  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await expect(verdict).toContainText('第 3 单元');
  await expect(page.getByTestId('actual-cell-2')).toHaveAttribute('data-diff', 'true');

  // 指针修正：关掉多出的点 5
  await page.getByTestId('actual-cell-2').locator('[data-dot="5"]').click();
  await expect(verdict).toHaveAttribute('data-state', 'match');

  // 键盘修正：聚焦第 2 单元按 4 加点，判定不一致后再按 4 复原
  await page.getByTestId('actual-cell-1').focus();
  await page.keyboard.press('4');
  await expect(verdict).toHaveAttribute('data-state', 'mismatch');
  await page.keyboard.press('4');
  await expect(verdict).toHaveAttribute('data-state', 'match');

  // 插入与删除：Enter 插入空单元，数字状态被结束、后续数字格缺标志而报解读错误；Backspace 删除后恢复一致
  await page.getByTestId('actual-cell-1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('actual-cell-3')).toBeVisible();
  await expect(verdict).toHaveAttribute('data-state', 'decode-error');
  await expect(page.getByTestId('decode-error')).toContainText('缺少数字标志');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('actual-cell-3')).toBeHidden();
  await expect(verdict).toHaveAttribute('data-state', 'match');
});

test('点位串导入：失败后可改用手工流程，原手工抄录仍能判定一致', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('code-input').fill('5');

  // 坏串导入失败不影响后续手工抄录
  await importTranscript(page, '3456|7');
  await expect(page.getByTestId('transcript-error')).toBeVisible();

  // 原手工入口：逐格添加并按 1–6 切换点位
  for (const dots of [SIGN, DIGIT['5']]) {
    await page.getByTestId('add-cell').click();
    for (const d of dots) await page.keyboard.press(String(d));
  }

  await expect(page.getByTestId('decoded-code')).toHaveText('5');
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-state', 'match');
  await expect(page.getByTestId('verdict')).toContainText('一致');
});
