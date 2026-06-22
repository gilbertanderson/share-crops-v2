import { test, type Route } from '@playwright/test';
import { ME, COMMUNITY, LISTINGS, TRENDING, seedAuth } from './fixtures';
function json(r: Route, b: unknown){ return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(b) }); }
test('create listing sheet', async ({ page }) => {
  await page.setViewportSize({ width: 460, height: 940 });
  await seedAuth(page);
  await page.route('**/functions/v1/make-server-dd877831/**', (route: Route) => {
    const p = new URL(route.request().url()).pathname.split('/make-server-dd877831')[1] || '';
    if (p === '/auth/me') return json(route,{user:ME});
    if (p === '/communities/mine') return json(route,{communities:[COMMUNITY],activeCommunityId:COMMUNITY.id});
    if (p.startsWith('/trending')) return json(route,{items:TRENDING});
    if (p.startsWith('/listings')) return json(route,{listings:LISTINGS});
    return json(route,{});
  });
  await page.goto('/marketplace');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /\+ List/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/v2-create.png' });
});
