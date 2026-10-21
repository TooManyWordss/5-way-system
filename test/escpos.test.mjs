import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeReceipt } from '../client/src/printing/escpos.ts';

const settings = { name: 'Café Ambiente', header: ['Iligan City'], footer: ['Thank you!'] };
const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('a 58 mm ESC/POS receipt fits 32 columns, prints plain ASCII and ends with feed and cut', () => {
  const bytes = encodeReceipt({
    label: '1001', created_at: '2026-10-19T04:00:00Z', table_name: 'Table 5', guests: 2,
    items: [{ name: 'Spanish Latte (16oz) with extra espresso shot', qty: 2, unit_price_cents: 18500 }, { name: 'Sweet Corn', qty: 1, unit_price_cents: 9000 }],
    subtotal_cents: 46000, tax_cents: 0, total_cents: 46000, cash_tendered_cents: 50000, change_cents: 4000,
  }, settings, { columns: 32, cut: true, drawer: false });
  const out = text(bytes);
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40], 'starts by resetting the printer');
  assert.ok(out.includes('Cafe Ambiente'), 'accents are dropped for the printer');
  assert.ok(out.includes('Receipt #1001'));
  assert.ok(out.includes('Table 5 - 2 guests'));
  assert.ok(out.includes('P370.00') && out.includes('P460.00') && out.includes('P40.00'));
  assert.ok([...bytes].every((b) => b < 0x80 || b === 0xfa), 'only ASCII text');
  // Every printed line fits the paper once the printer commands are taken out.
  const lines = out.replace(/\x1b@|\x1b[aE][\s\S]|\x1bp[\s\S]{3}|\x1d![\s\S]|\x1dV[\s\S]{2}/g, '').split('\n');
  for (const line of lines) assert.ok(line.length <= 32, `too long: "${line}"`);
  assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 0x42, 0x00], 'ends with a cut');
  assert.ok(lines.length > 10);
});

test('the barista receipt prints the order number large and a cash sale can open the drawer', () => {
  const bytes = encodeReceipt({ label: 'B-0007', station: 'barista', items: [], total_cents: 0 },
    { ...settings, title: 'Coffee Bar' }, { columns: 32, cut: false, drawer: true });
  const out = text(bytes);
  assert.ok(out.includes('\x1d\x21\x11Order B-0007'), 'double width and height');
  assert.ok(out.includes('Coffee Bar'));
  assert.deepEqual([...bytes.slice(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});
