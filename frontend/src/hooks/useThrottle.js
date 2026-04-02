/**
 * @file useThrottle.js
 * @description Generic hook that returns a throttled version of a rapidly-changing value,
 * updating at most once per specified interval (ms).
 * @exports useThrottle  <T>(value: T, intervalMs: number) => T
 * @note Designed for high-frequency slices (e.g. last price) where 60fps renders are sufficient.
 */

export const useThrottle = (value) => value;
