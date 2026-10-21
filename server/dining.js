import { floorMetricsVisits } from './tables/metrics.js';
import { registerDining } from '../dining-server.js';
import { app, storeBroadcast } from './core/http.js';
import { db } from './core/db.js';
import { currentStore, TAX_RATE, receiptForStore } from './core/config.js';
import { requireRole } from './auth/sessions.js';
import { loadOrder, logActivity } from './sales/orders.js';
import { announceStock, applyRecipes } from './inventory/stock.js';
registerDining({ app, db, requireRole, currentStore, broadcast: storeBroadcast, taxRate: TAX_RATE, loadOrder, logActivity, announceStock, applyRecipes, extraMetricsVisits: floorMetricsVisits, receiptConfig: () => receiptForStore('cashier') });
