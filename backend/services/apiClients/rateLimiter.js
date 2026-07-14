export default function createRateLimiter(minTime) {
  let lastCall = 0;
  let reservationTail = Promise.resolve();

  const schedule = async (fn) => {
    const reservation = reservationTail.then(async () => {
      const wait = Math.max(0, minTime - (Date.now() - lastCall));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
    });
    reservationTail = reservation.catch(() => {});
    await reservation;
    return fn();
  };

  return {
    schedule,
    wrap(fn) {
      return (...args) => schedule(() => fn(...args));
    },
  };
}
