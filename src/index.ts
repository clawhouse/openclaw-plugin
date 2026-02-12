import { clawHousePlugin } from './channel';
import { setClawHouseRuntime } from './runtime';
import { createClawHouseTools } from './tools';
import type { OpenClawPluginApi } from './types';

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
