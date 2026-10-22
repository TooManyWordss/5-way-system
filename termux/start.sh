#!/data/data/com.termux/files/usr/bin/bash
# Runs the café server on this tablet, opens the POS, and restarts the server if it ever stops.
cd "$(dirname "$0")/.."
# Half-updated Termux libraries stop node with "cannot link executable"; restarting would only repeat it.
if ! node -v > /dev/null 2>&1; then
  echo "Node can't start on this tablet. Connect to the internet and run:  pkg upgrade -y"
  echo "Then type: cafe"
  exit 1
fi
# Keeps Android from putting Termux to sleep while the café is open.
termux-wake-lock 2>/dev/null || true

# This tablet's address on the café Wi-Fi, or on its own hotspot, for the kitchen's QR code.
# Android hides it from the server, and some Android versions block one way of asking, so try several.
find_ip() {
  local ip
  for dev in wlan0 swlan0 ap0 wlan1; do
    ip="$(ip -4 addr show "$dev" 2>/dev/null | grep -o 'inet [0-9.]*' | cut -d' ' -f2 | head -1)"
    [ -n "$ip" ] || ip="$(ifconfig "$dev" 2>/dev/null | grep -o 'inet [0-9.]*' | cut -d' ' -f2 | head -1)"
    [ -n "$ip" ] && { echo "$ip"; return; }
  done
  command -v termux-wifi-connectioninfo > /dev/null &&
    termux-wifi-connectioninfo 2>/dev/null | grep -o '"ip": *"[0-9.]*"' | grep -o '[0-9.]\{7,\}' | grep -v '^0\.0\.0\.0$'
}

# Open the POS in the browser once the server is up.
( sleep 6; termux-open-url "http://localhost:3000/pos" 2>/dev/null ) &

while true; do
  # Looked up on every start, so a new Wi-Fi address after a router restart is picked up.
  IP="$(find_ip)"
  if [ -n "$IP" ]; then export LAN_URL="http://$IP:3000"; else unset LAN_URL; fi
  echo "Café server starting. Keep this tablet plugged in and leave Termux open."
  echo "  POS on this tablet:  http://localhost:3000/pos"
  if [ -n "$IP" ]; then
    echo "  Kitchen tablet:      http://$IP:3000/kitchen   (or on the POS: More → Connect kitchen tablet)"
  else
    echo "  Kitchen tablet:      this tablet has no Wi-Fi address yet. Connect it to the café Wi-Fi or turn on its hotspot."
  fi
  echo
  node --env-file-if-exists=.env server.js
  echo "The server stopped. Restarting in 3 seconds... (press Ctrl+C twice to quit)"
  sleep 3
done
