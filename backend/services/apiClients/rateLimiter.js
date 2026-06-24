export default function createRateLimiter(minTime) {
  let lastCall = 0;

  const schedule = async (fn) => {
    const now = Date.now();
    const wait = Math.max(0, minTime - (now - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  };

  return {
    schedule,
    wrap(fn) {
      return (...args) => schedule(() => fn(...args));
    },
  };
}
