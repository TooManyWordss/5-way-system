process.env.TZ ??= 'Asia/Manila';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

// The project folder (two levels up from server/core): dist/, client/ and the databases live there.
export const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const STORES = {
  ambiente: { name: 'Café Ambiente', receipt: 'Café Ambiente' },
  rairock: { name: 'RaiRock Seafoods', receipt: 'RaiRock Seafoods' },
};
export const storeContext = new AsyncLocalStorage();
export const currentStore = () => storeContext.getStore() || 'ambiente';
export const storePath = (req, path) => `${req.store === 'rairock' ? '/rairock' : ''}${path}`;
export const PORT = Number(process.env.PORT || 3000);
// Sales tax as a fraction, e.g. TAX_RATE=0.12 for 12%. Defaults to no tax.
export const TAX_RATE = Number(process.env.TAX_RATE || 0);
// Printed receipts: extra lines under the café name (address, TIN…) and a closing line.
// Separate several lines with |, e.g. RECEIPT_HEADER="123 Rizal St, Manila|TIN 000-000-000-000"
export const splitLines = (text) => text.split('|').map((l) => l.trim()).filter(Boolean);
export const RECEIPT = {
  name: process.env.RECEIPT_NAME || 'Café Ambiente',
  header: splitLines(process.env.RECEIPT_HEADER || ''),
  footer: splitLines(process.env.RECEIPT_FOOTER || 'Thank you! Please come again.'),
};
export const receiptForStore = (station) => currentStore() === 'rairock'
  ? { name: 'RaiRock Seafoods', header: splitLines(process.env.RAIROCK_RECEIPT_HEADER || ''),
      footer: splitLines(process.env.RAIROCK_RECEIPT_FOOTER || 'Thank you! Please come again.'),
      ...(station === 'barista' ? { title: 'Barista' } : {}) }
  : station === 'barista' ? BARISTA_RECEIPT : RECEIPT;
// The barista bar prints its own receipts: own title, numbering (B-0001…) and closing lines.
export const BARISTA_RECEIPT = {
  ...RECEIPT,
  title: process.env.BARISTA_RECEIPT_TITLE || 'Coffee Bar',
  header: splitLines(process.env.BARISTA_RECEIPT_HEADER ?? process.env.RECEIPT_HEADER ?? ''),
  footer: splitLines(process.env.BARISTA_RECEIPT_FOOTER || 'Listen for your number at the bar.|Enjoy your coffee!'),
};

// Stock is updated from its own screen, with its own login.
export const STOCK_KEEPERS = ['inventory'];

// The app screens are only served to someone logged in with the right code.
// The barista bar is the POS page; it reads its station from the address.
export const PAGE = { pos: 'pos', barista: 'pos', kitchen: 'kitchen', inventory: 'inventory', admin: 'admin' };
