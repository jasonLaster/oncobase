import { waitUntil } from "@vercel/functions";

/** Keep post-response work alive on Vercel (Fluid may otherwise freeze or
 * recycle the instance once the response ends). Outside a Vercel request
 * context (Vite dev, standalone server, tests) the task just runs. Failures
 * are logged, never surfaced as unhandled rejections. */
export function runAfterResponse(task: Promise<unknown>, label = "background task", extend: (task: Promise<unknown>) => void = waitUntil) {
  const guarded = task.catch((error: unknown) => {
    console.error(`[${label}] failed after response:`, error);
  });
  try {
    extend(guarded);
  } catch {
    // No request context to extend; the promise still runs to completion.
  }
}
