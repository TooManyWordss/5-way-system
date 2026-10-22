// ESC/POS receipt printing for thermal printers such as the common 58 mm "58H" models.
// The receipt is built as printer commands (text, bold, double size, cut) and sent one of three ways:
//   rawbt – the RawBT Android app, which passes it on over USB or Bluetooth (works with almost any printer)
//   usb   – straight from Chrome over USB (WebUSB; needs HTTPS or localhost)
//   ble   – straight from Chrome over Bluetooth Low Energy (only printers that offer BLE)

export type PrintMethod = 'system' | 'rawbt' | 'usb' | 'ble';
export type ReceiptLine = { name?: string; qty: number; unit_price_cents?: number };
export type ReceiptData = {
  label: string; station?: string; created_at?: string; items?: ReceiptLine[];
  subtotal_cents?: number; tax_cents?: number; total_cents?: number;
  cash_tendered_cents?: number | null; change_cents?: number | null;
  table_name?: string | null; guests?: number | null; staff_name?: string | null;
  offline?: boolean; reprint?: boolean; test?: boolean;
};
export type ReceiptSettings = { name: string; title?: string; header?: string[]; footer?: string[] };
export type PrintOptions = { columns: number; cut: boolean; drawer: boolean };

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

// Cheap printers only reliably print plain ASCII: "Café" → "Cafe", "₱" → "P".
function ascii(text: string) {
  return text.replace(/₱/g, 'P').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/…/g, '...')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
}
const peso = (cents = 0) => `P${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clock = (date?: string) => date ? new Date(date).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

class Receipt {
  private bytes: number[] = [];
  private columns: number;
  constructor(columns: number) { this.columns = columns; this.raw(ESC, 0x40); } // reset the printer
  raw(...b: number[]) { this.bytes.push(...b); return this; }
  align(where: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, where === 'left' ? 0 : where === 'center' ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(wide: boolean, tall: boolean) { return this.raw(GS, 0x21, (wide ? 0x10 : 0) | (tall ? 0x01 : 0)); }
  text(value: string) { for (const ch of ascii(value)) this.bytes.push(ch.charCodeAt(0)); return this; }
  line(value = '') { return this.text(value).raw(LF); }
  rule() { return this.line('-'.repeat(this.columns)); }
  // "2 x Iced Latte ........ P300.00", wrapping long names onto the next line.
  row(left: string, right: string, width = this.columns) {
    const room = Math.max(1, width - right.length - 1);
    const words = ascii(left).split(' ');
    const lines: string[] = [''];
    for (const word of words) {
      const current = lines[lines.length - 1];
      if (!current) lines[lines.length - 1] = word.slice(0, room);
      else if (current.length + 1 + word.length <= room) lines[lines.length - 1] = `${current} ${word}`;
      else lines.push(`  ${word}`.slice(0, room));
    }
    lines.forEach((l, i) => this.line(i === lines.length - 1 ? l.padEnd(width - right.length) + right : l));
    return this;
  }
  done() { return new Uint8Array(this.bytes); }
}

export function encodeReceipt(r: ReceiptData, settings: ReceiptSettings, options: PrintOptions) {
  const p = new Receipt(options.columns);
  p.align('center').bold(true).size(false, true).line(settings.name).size(false, false).bold(false);
  if (r.station === 'barista' && settings.title) p.line(settings.title);
  for (const h of settings.header ?? []) p.line(h);
  p.rule();
  if (r.test) p.line('Test receipt').line('ESC/POS printer is working');
  if (r.offline) p.line('Saved offline').line('Number given when sent');
  if (r.reprint) p.bold(true).line('REPRINT').bold(false);
  if (r.station === 'barista' && r.label) p.bold(true).size(true, true).line(`Order ${r.label}`).size(false, false).bold(false);
  else if (!r.test && r.label) p.bold(true).line(`Receipt #${r.label}`).bold(false);
  p.line(clock(r.created_at));
  if (r.table_name) p.line(`${r.table_name}${r.guests ? ` - ${r.guests} guest${r.guests === 1 ? '' : 's'}` : ''}`);
  if (r.staff_name) p.line(`Served by ${r.staff_name}`);
  p.align('left').rule();
  for (const i of r.items ?? []) p.row(`${i.qty} x ${i.name ?? ''}`, peso((i.unit_price_cents ?? 0) * i.qty));
  p.rule();
  if (r.tax_cents) p.row('Subtotal', peso(r.subtotal_cents)).row('Tax', peso(r.tax_cents));
  // Double-width text fits half as many characters.
  p.bold(true).size(true, false).row('TOTAL', peso(r.total_cents), Math.floor(options.columns / 2)).size(false, false).bold(false);
  if (r.cash_tendered_cents != null) p.row('Cash', peso(r.cash_tendered_cents)).row('Change', peso(r.change_cents ?? 0));
  p.rule().align('center');
  for (const f of settings.footer ?? []) p.line(f);
  p.raw(LF, LF, LF, LF);
  if (options.cut) p.raw(GS, 0x56, 0x42, 0x00); // feed and cut; printers without a cutter ignore it
  if (options.drawer) p.raw(ESC, 0x70, 0x00, 0x19, 0xfa); // kick the cash drawer plugged into the printer
  return p.done();
}

// The kitchen's copy when no kitchen screen is connected: what to cook, large, with no prices.
// It prints after the customer's receipt on the same printer, ready to tear off.
export function encodeKitchenSlip(r: ReceiptData, options: PrintOptions) {
  const p = new Receipt(options.columns);
  p.align('center').bold(true).size(true, true).line('KITCHEN').size(false, true).line(r.table_name ?? 'Takeout').size(false, false).bold(false);
  if (r.guests) p.line(`${r.guests} guest${r.guests === 1 ? '' : 's'}`);
  p.line([r.label ? `Receipt #${r.label}` : '', clock(r.created_at)].filter(Boolean).join(' - '));
  if (r.offline) p.line('Saved offline');
  if (r.reprint) p.line('REPRINT');
  p.align('left').rule().bold(true).size(false, true);
  for (const i of r.items ?? []) p.row(`${i.qty} x ${i.name ?? ''}`, '');
  p.size(false, false).bold(false).rule();
  p.raw(LF, LF, LF, LF);
  if (options.cut) p.raw(GS, 0x56, 0x42, 0x00);
  return p.done();
}

// Several printouts sent to the printer as one job.
export function joinPrints(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ---------- Sending ----------

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// RawBT (Android app) receives the raw bytes and forwards them to the paired USB/Bluetooth printer.
function sendRawBT(bytes: Uint8Array) {
  location.href = `intent:base64,${toBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// --- USB (WebUSB) ---
const usbApi = () => (navigator as any).usb;
let usbDevice: any = null;
async function openUsb(device: any) {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  // Prefer the printer-class interface (7); otherwise any interface with a bulk OUT endpoint.
  const interfaces = device.configuration.interfaces;
  const pick = interfaces.find((i: any) => i.alternate.interfaceClass === 7) ?? interfaces.find((i: any) => i.alternate.endpoints.some((e: any) => e.direction === 'out' && e.type === 'bulk'));
  if (!pick) throw new Error('This USB device has no way to send print data');
  if (!pick.claimed) await device.claimInterface(pick.interfaceNumber);
  const endpoint = pick.alternate.endpoints.find((e: any) => e.direction === 'out' && e.type === 'bulk');
  usbDevice = { device, endpoint: endpoint.endpointNumber };
  return device;
}
async function sendUsb(bytes: Uint8Array) {
  if (!usbDevice) {
    // A printer allowed before is remembered by Chrome, so it reconnects without asking.
    const [known] = (await usbApi()?.getDevices?.()) ?? [];
    if (!known) throw new Error('No USB printer connected. Open Printer settings and tap Connect.');
    await openUsb(known);
  }
  for (let i = 0; i < bytes.length; i += 4096) await usbDevice.device.transferOut(usbDevice.endpoint, bytes.slice(i, i + 4096));
}

// --- Bluetooth Low Energy (Web Bluetooth) ---
// Services that BLE receipt printers commonly use for print data.
const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ffe0-0000-1000-8000-00805f9b34fb'];
let bleWriter: { characteristic: any; name: string } | null = null;
async function sendBle(bytes: Uint8Array) {
  if (!bleWriter) throw new Error('Bluetooth printer not connected. Open Printer settings and tap Connect.');
  const c = bleWriter.characteristic;
  if (!c.service.device.gatt.connected) await c.service.device.gatt.connect();
  for (let i = 0; i < bytes.length; i += 100) {
    const chunk = bytes.slice(i, i + 100);
    if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(chunk); else await c.writeValue(chunk);
  }
}

// Asks the browser for the printer. Must run from a tap (browsers require it).
export async function connectPrinter(method: PrintMethod): Promise<string> {
  if (method === 'usb') {
    if (!usbApi()) throw new Error('This browser cannot use USB printers. Use Chrome on Android over HTTPS, or the RawBT app.');
    const device = await openUsb(await usbApi().requestDevice({ filters: [] }));
    return device.productName || 'USB printer';
  }
  if (method === 'ble') {
    const bluetooth = (navigator as any).bluetooth;
    if (!bluetooth) throw new Error('This browser cannot use Bluetooth printers. Use Chrome over HTTPS, or the RawBT app.');
    const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    const server = await device.gatt.connect();
    for (const uuid of BLE_SERVICES) {
      try {
        const service = await server.getPrimaryService(uuid);
        const characteristic = (await service.getCharacteristics()).find((c: any) => c.properties.write || c.properties.writeWithoutResponse);
        if (characteristic) { bleWriter = { characteristic, name: device.name || 'Bluetooth printer' }; return bleWriter.name; }
      } catch { /* not this service */ }
    }
    device.gatt.disconnect();
    throw new Error('This printer does not accept print data over Bluetooth Low Energy. Use the RawBT app instead.');
  }
  return method === 'rawbt' ? 'RawBT app' : 'Print screen';
}

export function connectedPrinter(method: PrintMethod) {
  if (method === 'usb') return usbDevice?.device.productName ?? null;
  if (method === 'ble') return bleWriter?.name ?? null;
  return null;
}

export async function sendToPrinter(method: PrintMethod, bytes: Uint8Array) {
  if (method === 'rawbt') return sendRawBT(bytes);
  if (method === 'usb') return sendUsb(bytes);
  if (method === 'ble') return sendBle(bytes);
  throw new Error('Not an ESC/POS printer');
}
