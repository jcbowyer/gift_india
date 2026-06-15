import { createApp, lakebase, server } from '@databricks/appkit';
import { setupgift_indiaRoutes } from './routes/gift_india/routes';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupgift_indiaRoutes(appkit);
  },
}).catch(console.error);
