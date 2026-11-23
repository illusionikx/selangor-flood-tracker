# Push notification setup on the box

This procedure gives the server the key that it needs to send notifications. Do it one time.

The box is a Debian container (LXC) on Proxmox. Do all the steps inside the container, not on the
Proxmox host.

## Before you start

Push the commit that raises the four stylesheet version numbers in `index.html`. Without it, the
bell icon in Settings stays a black box on a phone that holds an old stylesheet.

## Set up the server

1. Open the Proxmox host shell.
2. Find the ID of the container:

   ```bash
   pct list
   ```

3. Enter the container:

   ```bash
   pct enter <ID>
   ```

4. Paste this block. It needs no edits. You can run it two times safely, because it never replaces
   a key.

   ```bash
   bash <<'EOF'
   set -u
   ROOT=$(nginx -T 2>/dev/null | awk '$1=="root"{sub(/;$/,"",$2); print $2}' | sort -u |
     while read -r d; do [ -f "$d/api.php" ] && { echo "$d"; break; }; done)
   [ -n "$ROOT" ] || { echo "FAIL: no nginx root holds api.php"; exit 1; }
   STATE=$ROOT; [ -f "$(dirname "$ROOT")/build.mjs" ] && STATE=$(dirname "$ROOT")
   SRC=$ROOT; [ -f "$SRC/push-keys.php" ] || SRC=$STATE
   [ -f "$SRC/push-keys.php" ] || SRC=/srv/flood
   U=$(stat -c %U "$STATE/.history.db" 2>/dev/null || echo www-data)
   echo "root=$ROOT state=$STATE source=$SRC user=$U"

   php -m | grep -qi '^gmp$' || { apt-get install -y php-gmp && systemctl restart 'php*-fpm'; }
   [ -d "$SRC/lib/minishlink" ] || su -s /bin/sh "$U" -c \
     "cd '$SRC' && COMPOSER_HOME='$SRC/.composer' composer install --no-dev --no-interaction"

   if [ ! -f "$STATE/.vapid.json" ]; then
     (cd "$SRC" && php push-keys.php)
     F=$(ls "$SRC/.vapid.json" "$(dirname "$SRC")/.vapid.json" 2>/dev/null | head -1)
     [ "$F" = "$STATE/.vapid.json" ] || mv "$F" "$STATE/.vapid.json"
   fi
   chown "$U": "$STATE/.vapid.json"; chmod 600 "$STATE/.vapid.json"

   echo "--- result"
   curl -s -w ' HTTP %{http_code}\n' 'http://127.0.0.1/api.php?push=key'
   tail -n 5 "$STATE/.php-error.log" 2>/dev/null
   EOF
   ```

5. Read the lines after `--- result`.

   | Output | Meaning |
   |---|---|
   | A long key string and `HTTP 200` | The server is ready. Go to the phone steps. |
   | `{"key":null} HTTP 503` | The server cannot read the key. The lines below it give the cause. |
   | `FAIL: no nginx root holds api.php` | The script did not find the app. Keep the output. |

## What the block does

- It reads the document root from nginx.
- It finds the state directory, where `api.php` keeps `.history.db`.
- If PHP does not have `php-gmp`, it installs `php-gmp`.
- If the `lib/` directory has no sender library, it runs `composer install --no-dev`.
- If `.vapid.json` does not exist, it runs `php push-keys.php`.
- It gives `.vapid.json` to the user that owns `.history.db`, with mode 600.
- It asks the server for the public key and prints the answer.

## Test on the phone

1. Open the installed app.
2. Open Settings, then Notifications.
3. Turn on "Show notifications".
4. Allow the question from the browser.
5. Turn on one row below the master switch. The master switch alone sends nothing.
6. Press "Send a test notification".
7. Lock the phone and wait one minute.

## If the test does not arrive

Run this command in the container. Keep the output.

```bash
tail -n 30 $(dirname $(find /srv -maxdepth 3 -name .vapid.json | head -1))/.php-error.log
```

## Known limits

- Nobody tested a real send before this procedure. The test in the phone steps is the first one.
- Do not run `php push-keys.php` again after phones subscribe. A new key cuts off each subscribed
  phone.
- Do not change the owner of `.vapid.json` from the Proxmox host. The user IDs on the host are not
  the user IDs in the container.
