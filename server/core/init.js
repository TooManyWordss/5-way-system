import { storeContext, STORES } from './config.js';
import { initSchema } from './db.js';
import { seedTables } from '../tables/seed.js';
import { seedMenu } from '../menu/seed.js';

for (const store of Object.keys(STORES)) storeContext.run(store, () => { initSchema(); seedMenu(); seedTables(); });
