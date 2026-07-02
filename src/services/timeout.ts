// Note: this races the promise, it doesn't cancel the underlying operation — the
// original call keeps running in the background. That's an acceptable tradeoff
// here: the goal is to stop a hung request from silently blocking the poller
// forever, not to free the resources it's holding.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // If `promise` rejects *after* the timeout has already won the race below,
  // nothing else is listening for that rejection — Node treats it as an
  // unhandled rejection, which can terminate the process. This no-op catch
  // marks the original promise as handled without affecting the race outcome.
  promise.catch(() => {});

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}
