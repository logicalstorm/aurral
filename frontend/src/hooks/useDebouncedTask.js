import { useRef, useCallback } from "react";

export function useDebouncedTask() {
  const timerRef = useRef(null);
  const generationRef = useRef(0);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    generationRef.current += 1;
  }, []);

  const schedule = useCallback((task, delayMs) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      task(() => generation === generationRef.current);
    }, delayMs);
  }, []);

  return { schedule, cancel };
}
