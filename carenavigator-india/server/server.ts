import { createApp, lakebase, server } from '@databricks/appkit';
import { setupCareNavigatorRoutes } from './routes/carenavigator/routes';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupCareNavigatorRoutes(appkit);
  },
}).catch(console.error);
