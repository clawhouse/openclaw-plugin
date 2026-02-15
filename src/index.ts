import { clawHousePlugin } from './channel';
import { ClawHouseClient, ClawHouseError } from './client';
import { setClawHouseRuntime } from './runtime';
import { createClawHouseTools } from './tools';
import type { OpenClawPluginApi } from './types';

// Export useful types and classes for external usage
export { ClawHouseClient, ClawHouseError } from './client';
export type * from './types';

const plugin = {
  id: 'clawhouse',
  name: 'ClawHouse',

  register(api: OpenClawPluginApi) {
    setClawHouseRuntime(api.runtime);
    api.registerChannel({ plugin: clawHousePlugin });
    api.registerTool(() => {
      return createClawHouseTools(api);
    });
  },
};

export default plugin;
