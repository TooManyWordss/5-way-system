#!/data/data/com.termux/files/usr/bin/bash
# Installs, or updates, the café server on this tablet. In Termux, run:
#   curl -fsSL __CLOUD_URL__/tablet | bash
# Updating keeps the sales (in ~/cafe-pos-data) and the settings (~/cafe-pos/.env).

# Everything is inside main(), so nothing runs unless the whole script arrived.
main() {
  set -e
  local CLOUD_URL="__CLOUD_URL__"
  local APP_DIR="$HOME/cafe-pos" DATA_DIR="$HOME/cafe-pos-data"
  local JAR; JAR="$(mktemp)"
  trap 'rm -f "$JAR"' EXIT

  echo "== 1/5 Installing tools (a few minutes the first time) =="
  pkg update -y < /dev/null
  pkg install -y nodejs-lts tar < /dev/null || pkg install -y nodejs tar < /dev/null
  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
    pkg uninstall -y nodejs-lts < /dev/null || true
    pkg install -y nodejs < /dev/null   # the database needs Node 22.13 or newer
  fi
  pkg install -y cloudflared < /dev/null || echo "(cloudflared unavailable: remote owner access will be off)"
  echo "Node $(node -v) ready."

  echo "== 2/5 Downloading the café system =="
  local OWNER="${CAFE_OWNER_PASSWORD:-}"
  [ -n "$OWNER" ] || { read -rsp "Owner password (the one you use for the admin panel): " OWNER < /dev/tty; echo; }
  local BODY; BODY="$(node -e 'console.log(JSON.stringify({role:"admin",secret:process.argv[1]}))' "$OWNER")"
  if ! curl -fsS -c "$JAR" -H 'Content-Type: application/json' -d "$BODY" "$CLOUD_URL/api/login" > /dev/null; then
    echo "Could not sign in: wrong owner password, or no internet. Nothing was changed."; exit 1
  fi
  mkdir -p "$APP_DIR" "$DATA_DIR"
  curl -fsS -b "$JAR" "$CLOUD_URL/api/admin/tablet-package" -o "$APP_DIR/package.tgz"
  cd "$APP_DIR"
  rm -rf server dist client termux          # old app files only; .env and the sales stay
  tar -xzf package.tgz && rm package.tgz

  echo "== 3/5 Installing the app's libraries =="
  npm ci --omit=dev --no-audit --no-fund < /dev/null

  echo "== 4/5 Settings =="
  if [ -f .env ]; then
    echo "Keeping this tablet's settings."
  else
    local PIN="${CAFE_PIN:-}"
    [ -n "$PIN" ] || { read -rp "PIN for the POS, barista, kitchen and inventory screens [123456789]: " PIN < /dev/tty; }
    PIN="${PIN:-123456789}"
    local TOKEN SECRET TUNNEL=0
    TOKEN="$(curl -fsS -b "$JAR" -X POST "$CLOUD_URL/api/admin/tablet-link" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).token))')"
    SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    command -v cloudflared > /dev/null && TUNNEL=1
    {
      echo "POS_PIN=$PIN"; echo "BARISTA_PIN=$PIN"; echo "KITCHEN_PIN=$PIN"; echo "INVENTORY_PIN=$PIN"
      echo "ADMIN_PASSWORD=$OWNER"; echo "SESSION_SECRET=$SECRET"
      echo "TZ=Asia/Manila"; echo "PORT=3000"; echo "DATA_DIR=$DATA_DIR"
      echo "CLOUD_URL=$CLOUD_URL"; echo "CLOUD_TOKEN=$TOKEN"; echo "TUNNEL=$TUNNEL"
    } > .env
    chmod 600 .env
    echo "Saved. Change PINs or the owner password later in Admin → Staff & sign-in."
  fi

  echo "== 5/5 Shortcuts =="
  grep -q "alias cafe=" "$HOME/.bashrc" 2>/dev/null || echo "alias cafe='bash \"$APP_DIR/termux/start.sh\"'" >> "$HOME/.bashrc"
  mkdir -p "$HOME/.termux/boot"   # used by the Termux:Boot app, if installed: starts the café when the tablet turns on
  printf '#!/data/data/com.termux/files/usr/bin/bash\nbash "%s/termux/start.sh"\n' "$APP_DIR" > "$HOME/.termux/boot/start-cafe"
  chmod +x "$HOME/.termux/boot/start-cafe"

  echo
  echo "All set. Starting the café server... (next time, just type: cafe)"
  exec bash "$APP_DIR/termux/start.sh"
}
main
