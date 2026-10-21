#!/data/data/com.termux/files/usr/bin/bash
# Runs the café server on this tablet, opens the POS, and restarts the server if it ever stops.
cd "$(dirname "$0")/.."
# Keeps Android from putting Termux to sleep while the café is open.
termux-wake-lock 2>/dev/null || true

# This tablet's address on the café Wi-Fi, for the kitchen's QR code (Android hides it from the server).
IP="$(ip -4 addr show wlan0 2>/dev/null | grep -o 'inet [0-9.]*' | cut -d' ' -f2)"
[ -n "$IP" ] && export LAN_URL="http://$IP:3000"

echo "Café server starting. Keep this tablet plugged in and leave Termux open."
echo "  POS on this tablet:  http://localhost:3000/pos"
echo "  Kitchen tablet:      on the POS, tap More → Connect kitchen tablet and scan the code"
echo

# Open the POS in the browser once the server is up.
( sleep 6; termux-open-url "http://localhost:3000/pos" 2>/dev/null ) &

while true; do
  node --env-file-if-exists=.env server.js
  echo "The server stopped. Restarting in 3 seconds... (press Ctrl+C twice to quit)"
  sleep 3
done
