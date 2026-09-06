import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { test, expect, signIn } from './fixtures';

test('gate and account sessions survive a frontend cutover', async ({ page, playwright }, info) => {
  const source = String(info.project.use.baseURL);
  const target = source === process.env.PARITY_NEXT_URL ? process.env.PARITY_VITE_URL! : process.env.PARITY_NEXT_URL!;
  const email = `parity-session-${randomUUID()}@example.test`;
  const client = new ConvexHttpClient(process.env.PARITY_CONVEX_URL!);
  const lookup = () => client.query(makeFunctionReference<'query'>('users:getByEmailForAuth'), { email, siteSlug: 'diana' });
  const journal = info.outputPath('account-cleanup.json');
  const record = (state: string) => writeFile(journal, JSON.stringify({ state, email, source, target }, null, 2));
  await signIn(page);
  expect(await lookup()).toBeNull();
  await record('pending');
  let peer: Awaited<ReturnType<typeof playwright.request.newContext>> | undefined;
  try {
    expect((await page.request.post('/api/auth/signup', { data: { email, name: 'QA session continuity', password: randomUUID() } })).ok()).toBe(true);
    const sourceSession = await (await page.request.get('/api/auth/session')).json();
    expect(sourceSession.user.email).toBe(email);
    const storage = await page.context().storageState();
    // Model the unchanged real hostname: carry cookie bytes, not new logins.
    peer = await playwright.request.newContext({ baseURL: target, storageState: {
      cookies: storage.cookies.map(cookie => ({ ...cookie, domain: new URL(target).hostname })), origins: [],
    } });
    expect((await peer.get('/api/wiki/manifest')).status()).toBe(200);
    const transferred = await (await peer.get('/api/auth/session')).json();
    expect(transferred.user.email).toBe(email);
    expect(transferred.user.id ?? transferred.user._id).toBe(sourceSession.user.id ?? sourceSession.user._id);
    expect(transferred.user.isAdmin).toBe(false);
    const owned = await lookup();
    const roles = await client.query(makeFunctionReference<'query'>('access:listRoles'), { siteSlug: 'diana' });
    const admin = roles.find((role: any) => role.name.trim().toLowerCase() === 'admin');
    expect(admin, 'Use an existing role; never modify production permission definitions').toBeTruthy();
    await client.mutation(makeFunctionReference<'mutation'>('access:setRoleForUser'), { siteSlug: 'diana', userId: owned._id, roleId: admin._id });
    expect((await (await peer.get('/api/auth/session')).json()).user.isAdmin).toBe(true);
    await client.mutation(makeFunctionReference<'mutation'>('access:setRoleForUser'), { siteSlug: 'diana', userId: owned._id });
    expect((await (await peer.get('/api/auth/session')).json()).user.isAdmin).toBe(false);
    expect((await peer.post('/api/auth/signout')).ok()).toBe(true);
    // Revocation must be shared across both frontends, not only clear a cookie.
    expect((await (await page.request.get('/api/auth/session')).json()).user).toBeNull();
  } finally {
    await peer?.dispose();
    await page.close();
    try {
      const user = await lookup();
      if (user) {
        expect(user.email).toBe(email);
        await client.mutation(makeFunctionReference<'mutation'>('access:deleteUsers'), { siteSlug: 'diana', userIds: [user._id] });
      }
      expect(await lookup()).toBeNull();
      await record('clean');
    } catch (error) { await record('cleanup-failed'); throw error; }
    finally { await info.attach('account-cleanup', { path: journal, contentType: 'application/json' }); }
  }
});
