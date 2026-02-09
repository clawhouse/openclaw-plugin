import type { PluginRuntime } from './types';

let _runtime: PluginRuntime | null = null;

export function setClawHouseRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getClawHouseRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error(
      'ClawHouse runtime not initialized. Ensure setClawHouseRuntime() is called during plugin registration.',
    );
  }
  return _runtime;
}
