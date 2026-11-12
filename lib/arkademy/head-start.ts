/**
 * How long an Arkademy page waits for the library before it starts streaming.
 *
 * A page puts what reads the library behind a Suspense boundary, so a slow or
 * hung database never holds back the chrome and the h1. But React streams a
 * boundary's content into a hidden element that a script then moves into
 * place: without JavaScript (a no-script reader, an HTML-only crawler) the
 * placeholder is all there is to see. So a page first gives the library this
 * head start; when it answers in time (a warm cache answers in milliseconds),
 * the page renders without a boundary and the whole cover is in the HTML. Only
 * a slow read (a cache refill waking the database, an outage) streams.
 */
export const ARKADEMY_HEAD_START_MS = 300;

/**
 * `{ value }` when `promise` settles within `ms`, else `undefined` — never a
 * rejection (a promise that rejects in time rejects here too; the library
 * loader never rejects). The timer is cleared either way.
 */
export async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<{ value: T } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ value })), late]);
  } finally {
    clearTimeout(timer);
  }
}
