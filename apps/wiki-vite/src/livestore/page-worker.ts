/** The tab's leader lock is released on navigation before its worker necessarily
 * exits. Terminate the dedicated cache worker before the next document can win
 * that lock and open the same SQLite files. Server data is the source of truth.
 */
export function bindWorkerToPage<T extends { terminate(): void }>(worker: T, page: Window): T {
  const terminate = worker.terminate.bind(worker);
  const stop = () => worker.terminate();
  worker.terminate = () => {
    page.removeEventListener('beforeunload', stop);
    terminate();
  };
  page.addEventListener('beforeunload', stop, { once: true });
  return worker;
}
