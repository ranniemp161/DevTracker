import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`phone notification settings remain discoverable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const workspace = { id: 'workspace', name: 'Workspace', role: 'OWNER' };
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path.endsWith('/auth/me'))
        data = {
          user: { id: 'owner', username: 'owner', emailVerified: true },
          workspaces: [workspace],
        };
      if (path.endsWith('/projects/demo'))
        data = {
          project: {
            id: 'demo',
            name: 'Demo',
            key: 'DM',
            status: 'PLANNING',
            workspaceId: workspace.id,
          },
        };
      if (path.endsWith('/messages'))
        data = { messages: [], hasMoreAfter: false, hasMoreBefore: false };
      if (path.endsWith('/phone-notifications')) {
        await waiting;
        data = { publicKey: null, mode: 'off', deviceEnabled: false };
      }
      await route.fulfill({ json: { data } });
    });
    await page.goto('/projects/demo/chat');
    const toggle = page.getByText('Phone notifications', { exact: true });
    await expect(toggle).toBeInViewport();
    await toggle.click();
    await expect(page.getByText('Loading notification settings…')).toBeVisible();
    release();
    await expect(
      page.getByText('Phone notifications have not been configured on this server.'),
    ).toBeVisible();
  });
}
