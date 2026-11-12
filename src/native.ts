import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export const desktop = isTauri();
export async function command<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop) return undefined as T;
  return invoke<T>(name, args);
}
export async function onNative<T>(name: string, handler: (payload: T) => void) {
  if (!desktop) return () => {};
  return listen<T>(name, event => handler(event.payload));
}
