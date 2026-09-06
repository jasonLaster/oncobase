import { expect, test } from 'bun:test';
import { bindWorkerToPage } from './page-worker';

test('navigation terminates the worker synchronously and removes its listener', () => {
  const page = new EventTarget();
  let stops = 0;
  bindWorkerToPage({ terminate: () => { stops++; } }, page as Window);
  page.dispatchEvent(new Event('beforeunload'));
  expect(stops).toBe(1);
  page.dispatchEvent(new Event('beforeunload'));
  expect(stops).toBe(1);
});

test('normal adapter shutdown removes the navigation listener', () => {
  const page = new EventTarget();
  let stops = 0;
  const worker = bindWorkerToPage({ terminate: () => { stops++; } }, page as Window);
  worker.terminate();
  page.dispatchEvent(new Event('beforeunload'));
  expect(stops).toBe(1);
});
