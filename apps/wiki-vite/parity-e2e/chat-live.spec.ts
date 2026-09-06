import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { test, expect, signIn, checkpoint } from './fixtures';

test('real AI chat persists its response across reload', async ({ page }, info) => {
  test.setTimeout(180_000);
  const client = new ConvexHttpClient(process.env.PARITY_CONVEX_URL!);
  const title = `QA parity ${randomUUID()}`;
  const journal = info.outputPath('chat-cleanup.json');
  let id: string | undefined;
  let createdAt: number | undefined;
  const record = (state: string) => writeFile(journal, JSON.stringify({ state, id, title, createdAt, baseURL: info.project.use.baseURL }, null, 2));
  const query = (name: string) => client.query(makeFunctionReference<'query'>(`conversations:${name}`), { id, siteSlug: 'diana' });
  await record('pending');
  try {
    // Acquire an exact owned ID before sending provider work. No existing chats
    // are modified, and a failed response cannot strand an unknown conversation.
    id = await client.mutation(makeFunctionReference<'mutation'>('conversations:create'), { title, siteSlug: 'diana' });
    await record('pending');
    const initial = await query('get');
    expect(initial.title).toBe(title);
    expect(initial.messages).toEqual([]);
    createdAt = initial.createdAt;
    await record('pending');
    await signIn(page);
    await page.goto(`/chat/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-interface')).toHaveAttribute('data-chat-conversation-id', id!);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat' && r.request().method() === 'POST');
    await page.getByTestId('chat-composer-textarea').fill('This is a nonclinical software QA check. Reply with exactly: pong');
    await page.getByTestId('chat-submit-button').click();
    expect((await response).ok()).toBe(true);
    await expect(page.getByTestId('chat-assistant-message').last()).toContainText(/pong/i, { timeout: 90_000 });
    await expect.poll(async () => (await query('getMessages')).some((m: any) => m.role === 'assistant' && JSON.stringify(m).toLowerCase().includes('pong')), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => Boolean((await query('getStreamingState'))?.activeRunId), { timeout: 30_000 }).toBe(false);
    await checkpoint(page, info, 'chat-completed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-assistant-message').last()).toContainText(/pong/i);
    await expect(page.getByTestId('chat-interface')).toHaveAttribute('data-chat-status', 'ready');
    await checkpoint(page, info, 'chat-restored');

    // Stop must reach the real backend, not merely hide a local spinner.
    const stopPrompt = 'Nonclinical QA: write a 1200-word fictional story about a lighthouse. Do not use tools.';
    await page.getByTestId('chat-composer-textarea').fill(stopPrompt);
    await page.getByTestId('chat-submit-button').click();
    await expect.poll(async () => Boolean((await query('getStreamingState'))?.activeRunId)).toBe(true);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(async () => Boolean((await query('getStreamingState'))?.activeRunId)).toBe(false);
    await expect.poll(async () => (await query('getMessages')).some((m: any) => m.role === 'user' && m.content === stopPrompt && m.disabled === true)).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-interface')).toHaveAttribute('data-chat-status', 'ready');
    await checkpoint(page, info, 'chat-stopped-restored');

    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const ownedLink = page.getByTestId('conversation-list-item').filter({ visible: true }).and(page.locator(`[data-conversation-id="${id}"]`));
    const ownedRow = ownedLink.locator('..');
    await ownedRow.hover();
    await ownedRow.getByRole('button', { name: 'Conversation actions' }).click();
    await ownedRow.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect.poll(async () => (await query('get')).archived).toBe(true);
    await page.goto('/chat/archived', { waitUntil: 'domcontentloaded' });
    const archivedRow = page.getByTestId('chat-archived-item').filter({ has: page.locator(`a[href="/chat/${id}"]`) });
    await expect(archivedRow).toBeVisible();
    await checkpoint(page, info, 'chat-archived');
    await archivedRow.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect.poll(async () => Boolean((await query('get')).archived)).toBe(false);
    await page.goto(`/chat/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-assistant-message').first()).toContainText(/pong/i);
    await checkpoint(page, info, 'chat-unarchived');
  } finally {
    await page.close();
    try {
      if (id) {
        const owned = await query('get');
        if (owned) {
          expect(owned.createdAt).toBe(createdAt);
          await client.mutation(makeFunctionReference<'mutation'>('conversations:cancelStream'), { conversationId: id, siteSlug: 'diana' });
          await expect.poll(async () => Boolean((await query('getStreamingState'))?.activeRunId), { timeout: 30_000 }).toBe(false);
          await client.mutation(makeFunctionReference<'mutation'>('conversations:remove'), { id, siteSlug: 'diana' });
        }
        expect(await query('get')).toBeNull();
        expect(await query('getMessages')).toEqual([]);
      } else {
        // A failed create response is ambiguous. Do not advance automatically.
        throw new Error('Conversation creation ID unknown; reconcile the journal title before continuing');
      }
      await record('clean');
    } catch (error) { await record('cleanup-failed'); throw error; }
    finally { await info.attach('chat-cleanup', { path: journal, contentType: 'application/json' }); }
  }
});
