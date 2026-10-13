// Helpers shared by the POS, kitchen and admin screens.

const CURRENCY = 'PHP'; // Philippine peso, shown as ₱
const moneyFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: CURRENCY });

function money(cents) {
  return moneyFormat.format(cents / 100);
}

// "1,250.50", "₱ 20" -> cents. Returns NaN for anything that isn't a positive amount.
function parseMoney(text) {
  const value = Number(String(text).replace(/[^0-9.]/g, ''));
  return String(text).trim() && Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

// Peso bills and coins, largest first.
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Pages live at /pos, /barista, /kitchen, /inventory and /admin, so the path names the screen.
function goToLogin() {
  location.href = `/login.html?role=${location.pathname.slice(1)}`;
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  goToLogin();
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    goToLogin(); // login expired or was never made
    throw new Error('Logged out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // err.status tells "server said no" apart from "couldn't reach the server" (no status).
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Shows "Live" / "Offline" in the top bar so staff know if updates are flowing.
// onChange(isLive) lets a page react too, e.g. the kitchen's full-width warning.
function showConnection(socket, el, onChange = () => {}) {
  socket.on('connect', () => {
    el.textContent = 'Live';
    el.className = 'badge live';
    onChange(true);
  });
  socket.on('disconnect', () => {
    el.textContent = 'Offline – reconnecting…';
    el.className = 'badge offline';
    onChange(false);
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') goToLogin();
  });
}
