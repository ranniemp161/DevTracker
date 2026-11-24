import { expect, test } from '@playwright/test';

test('a creator can discover, override, restore and confirm their project key', async ({
  page,
}) => {
  const workspace = { id: 'workspace', name: 'Example', role: 'OWNER' };
  const submissions: Record<string, string>[] = [];
  let releaseAtlas!: () => void;
  const atlasGate = new Promise<void>((resolve) => {
    releaseAtlas = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/me')) {
      data = {
        user: { id: 'owner', username: 'owner', emailVerified: true },
        workspaces: [workspace],
      };
    } else if (url.pathname.endsWith('/workspaces/workspace')) {
      data = { workspace };
    } else if (url.pathname.endsWith('/projects/created')) {
      data = {
        project: {
          id: 'created',
          workspaceId: workspace.id,
          status: 'PLANNING',
          ...submissions.at(-1),
        },
      };
    } else if (url.pathname.endsWith('/key-suggestion')) {
      const base = url.searchParams.get('base');
      if (base === 'ATLAS') await atlasGate;
      data = { key: base === 'GOS' ? `GOS${3 + submissions.length}` : base?.trim() };
    } else if (route.request().method() === 'POST' && url.pathname.endsWith('/projects')) {
      submissions.push(route.request().postDataJSON());
      if (submissions.length <= 2) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'PROJECT_KEY_TAKEN', message: 'Key taken.' } },
        });
        return;
      }
      data = { project: { id: 'created' } };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto('/workspaces/workspace/projects/new');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  const key = page.getByRole('textbox', { name: 'Project key' });
  await expect(key).toHaveAttribute('placeholder', 'e.g. GOS');
  await expect(key).toHaveCSS('border-top-style', 'solid');
  await expect(key).not.toHaveCSS('border-top-width', '0px');
  const idleBorder = await name.evaluate((el) => getComputedStyle(el).borderTopColor);
  await expect(key).toHaveCSS('border-top-color', idleBorder);
  await expect(key).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByText(/suggest a key from the project name/i)).toBeVisible();
  await name.focus();
  await page.keyboard.press('Tab');
  await expect(key).toBeFocused();
  await expect(key).not.toHaveCSS('border-top-color', idleBorder);
  for (const [input, expected] of Object.entries({
    Inventory: 'INVEN',
    'Customer API': 'CAPI',
    'Grocery Order System': 'GOS',
    X: 'PX',
    '2027': 'P2027',
    '🌱': 'PRJ',
  })) {
    await name.fill(input);
    await expect(key).toHaveValue(expected);
  }
  const atlasRequest = page.waitForRequest((req) => req.url().includes('base=ATLAS'));
  await name.fill('Atlas');
  await expect(key).toHaveValue('ATLAS');
  await atlasRequest;
  await key.fill('SHOP');
  await name.fill('Grocery OS');
  const atlasResponse = page.waitForResponse((res) => res.url().includes('base=ATLAS'));
  releaseAtlas();
  await atlasResponse;
  await expect(key).toHaveValue('SHOP');
  await key.fill('GOS');
  await expect(page.getByRole('button', { name: 'Use GOS3' })).toBeVisible();
  await expect(key).toHaveValue('GOS');
  await page.getByRole('button', { name: 'Use suggested key' }).click();
  await expect(key).toHaveValue('GOS3');
  await expect(page.getByText(/Your first task will be GOS3-1/)).toBeVisible();
  await page.getByLabel('Description').fill('Keep my description');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(key).toHaveValue('GOS3');
  await page.getByRole('button', { name: 'Use GOS4' }).click();
  await expect(key).toHaveValue('GOS4');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Use GOS5' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/created/);
  expect(submissions.map((s) => s.key)).toEqual(['GOS3', 'GOS4', 'GOS5']);
  expect(submissions[2]).toMatchObject({ name: 'Grocery OS', description: 'Keep my description' });
});
