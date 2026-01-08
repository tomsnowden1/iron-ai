export function devLog(...args: unknown[]) {
  if (!import.meta.env.DEV) return;
  console.log(...args);
}
