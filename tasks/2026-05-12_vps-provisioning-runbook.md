# VPS Provisioning Runbook — e-Sharevice on Hetzner

**Created:** 2026-05-12 04:00 UTC
**Last Updated:** 2026-05-12 04:00 UTC
**Status:** Ready to execute

This runbook is the human-side companion to the infra-as-code in `infra/`. Follow top-to-bottom on a fresh VPS.

> Total wall-clock time: ~90 min if DNS is already in your registrar.

---

## 0. Prerequisites you need before starting

- A domain name (e.g. `your-domain.com`) you control DNS for. **Cloudflare** is recommended as the DNS host (free, DDoS, gives you R2 + Turnstile + Pages in one dashboard).
- A **GitHub** account/org that will host the container images (`ghcr.io/<owner>/esharevice-web` and `-api`).
- A **Cloudflare** account with:
  - DNS for the domain
  - R2 bucket created (`esharevice-images`) with an API token
- A **Backblaze B2** account with a bucket (`esharevice-backups`) and an Application Key.
- A password manager (1Password / Bitwarden) ready to receive ~10 generated secrets.
- An **age** key pair for backup encryption — generate locally first:
  ```bash
  age-keygen -o esharevice-backups.age
  # public key goes in infra/.env on the VPS as AGE_RECIPIENT
  # private key stays in your password manager, used only for restore drills
  ```

---

## 1. Provision the Hetzner box (10 min)

1. Hetzner Cloud → New Project → New Server.
2. **Image:** Ubuntu 24.04
3. **Type:** CX22 (~€4.5/mo, 2 vCPU / 4GB RAM / 40GB disk) for staging, or CX32 (~€8/mo, 4 vCPU / 8GB / 80GB) for production. The full stack with Authentik comfortably fits on CX22.
4. **Location:** the closest to your users (Falkenstein/Nuremberg/Helsinki for EU, Ashburn for US).
5. **Networking:** IPv4 + IPv6.
6. **SSH key:** upload yours; do not allow password login.
7. **Firewall:** create one named `esharevice` with inbound rules — **TCP 22, 80, 443** from anywhere; **UDP 443** from anywhere (HTTP/3). All other ports closed.
8. Boot.

Note the public IPv4 / IPv6.

---

## 2. DNS records (10 min)

In Cloudflare DNS, add four A records (and AAAA if you want IPv6) pointing to the VPS:

| Name | Type | Value | Proxy |
|---|---|---|---|
| `app.your-domain.com` | A | `<VPS IPv4>` | DNS only (gray cloud) |
| `api.your-domain.com` | A | `<VPS IPv4>` | DNS only |
| `auth.your-domain.com` | A | `<VPS IPv4>` | DNS only |
| `uptime.your-domain.com` | A | `<VPS IPv4>` | DNS only |

> **Important:** keep proxy *off* (gray cloud) initially. Caddy needs to hit Let's Encrypt directly to issue certs. You can flip the proxy on later if you want Cloudflare's CDN, but pin the SSL mode to "Full (strict)" and configure Caddy to skip its own TLS for proxied hostnames.

Wait 1-2 min for propagation. Verify: `dig +short app.your-domain.com` returns the VPS IP.

---

## 3. Harden the VPS (15 min)

SSH in as root, then:

```bash
# 3.1 Update + reboot
apt-get update && apt-get -y upgrade && reboot

# (Reconnect.)

# 3.2 Create a non-root user with sudo
adduser --gecos "" ops
usermod -aG sudo ops
rsync --archive --chown=ops:ops ~/.ssh /home/ops

# 3.3 Disable root SSH + password auth
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# 3.4 Unattended security upgrades
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# 3.5 ufw — only Caddy ports
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# 3.6 fail2ban
apt-get install -y fail2ban
systemctl enable --now fail2ban
```

Log out and log back in as `ops`. All further commands run as `ops` with `sudo`.

---

## 4. Install Docker (5 min)

```bash
# Official Docker install (skips Ubuntu's outdated docker.io package)
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow ops to use docker without sudo
sudo usermod -aG docker ops
newgrp docker

docker run --rm hello-world  # smoke test
```

---

## 5. Install Coolify (10 min)

Coolify gives you a UI for managing the Compose stack, env vars, deploy webhooks, and one-click rollbacks.

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

When it finishes, it prints a URL like `http://<VPS-IP>:8000` and a one-time admin code. Visit it, create the admin account immediately, then add a Cloudflare DNS-only record `coolify.your-domain.com` → VPS IP and configure Coolify's settings to use that hostname (with its own Let's Encrypt cert).

> **Skip Coolify if you prefer pure Compose.** Steps 6-9 work either way.

---

## 6. Clone the repo, populate secrets (15 min)

```bash
sudo mkdir -p /opt/esharevice
sudo chown ops:ops /opt/esharevice
cd /opt/esharevice
git clone https://github.com/<YOUR-OWNER>/esharevice.git .

cp infra/.env.example infra/.env
chmod 600 infra/.env

# Generate every "replace-me" value:
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> /tmp/gen
echo "AUTHENTIK_POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> /tmp/gen
echo "AUTHENTIK_SECRET_KEY=$(openssl rand -hex 50)" >> /tmp/gen
echo "SESSION_COOKIE_SECRET=$(openssl rand -hex 32)" >> /tmp/gen
cat /tmp/gen   # paste each into infra/.env, then:
shred -u /tmp/gen
```

Fill in the remaining fields manually in `infra/.env`:

- `DOMAIN=your-domain.com`
- `LETSENCRYPT_EMAIL=ops@your-domain.com`
- `GHCR_OWNER=<your-github-org-or-user>`
- `OIDC_CLIENT_SECRET=` — leave blank for now; we'll fill it after Authentik first-boot in step 8.
- `UPTIME_BASIC_AUTH_HASH=` — generate with `docker run --rm caddy:2-alpine caddy hash-password -plaintext 'your-pass'`

Save each generated value to your password manager **before continuing**.

---

## 7. Boot the stack (10 min)

```bash
cd /opt/esharevice/infra
# First boot: pull images, start data stores, then services.
docker compose pull
docker compose up -d postgres authentik-postgres redis
# Wait ~20 s for the databases to initialize, then bring up the rest:
sleep 20
docker compose up -d authentik-server authentik-worker
sleep 30   # Authentik first-boot migrations
docker compose up -d caddy uptime-kuma

# Tail Authentik until you see "successfully migrated":
docker compose logs -f authentik-server | grep -i migrat
```

Verify TLS:

```bash
curl -I https://auth.your-domain.com
curl -I https://uptime.your-domain.com   # 401 expected (basic auth)
```

The `api` and `web` services will fail to start until images are pushed — that's expected; we do that in step 9.

---

## 8. Configure Authentik (15 min)

1. Open `https://auth.your-domain.com/if/flow/initial-setup/` and set the `akadmin` password (save to your password manager).
2. Apply the e-Sharevice blueprint via **Customisation → Blueprints** (mounted from `/blueprints/custom/esharevice.yaml`). If it shows `status: error`, copy the blueprint instance UUID and either retry from the UI's three-dot menu or POST the apply endpoint:

   ```bash
   AK_TOKEN=<admin-token-from-Directory-Tokens-and-App-Passwords>
   curl --post301 --post302 -X POST \
     "https://auth.your-domain.com/api/v3/managed/blueprints/$INSTANCE_PK/apply/" \
     -H "Authorization: Bearer $AK_TOKEN" -H "Content-Length: 0"
   ```

   The reference blueprint already accounts for three subtleties Authentik enforces but doesn't document well:
   - Cannot create `CertificateKeyPair` from a blueprint (needs PEM `certificate_data`). Reference the built-in `"authentik Self-signed Certificate"`.
   - No `${VAR}` substitution in YAML literals; hardcode hostnames or use `!Env`/`!Context` tags.
   - `OAuth2Provider.redirect_uris` is required even for client_credentials clients — use `[]`.

3. **Applications → Providers → e-sharevice-web → Edit**. Copy the auto-generated **Client Secret**. Paste into `infra/.env` as `OIDC_CLIENT_SECRET=...`, then `docker compose up -d web` to restart with the value.
4. **Directory → Federation & Social Login → Create**. Add **Google** and **GitHub** providers; the redirect URI Authentik shows is what you paste into Google / GitHub OAuth app settings.
5. **Wire SMTP** (see step 8.5 below for the Resend dance) so password-reset and signup-verification emails leave Authentik.
6. Verify each social login by opening `https://auth.your-domain.com/if/flow/default-authentication-flow/` in a private window — both Google and GitHub buttons should appear.

### 8.5. Resend SMTP for Authentik emails (~5 min, but +DNS-propagation wait)

Without verified outbound email, Authentik can't send password resets, signup verifications, or admin alerts. Resend is the cleanest option for a small Hetzner deploy (free 3k/mo, clean React-email templating, transactional only — won't bounce-rate-tank your domain).

1. Resend account → https://resend.com/api-keys → **Create** a *send-only* API key (`emails:send`). Save to your password manager.
2. Resend dashboard → https://resend.com/domains → **Add Domain** → `your-domain.com`. Copy the 4 records Resend shows (MX, SPF TXT, DKIM TXT — sometimes 2 DKIM records, and an optional DMARC TXT).
3. Add the records to Cloudflare DNS (via dashboard or API). Wait 1-2 min for propagation, then click **Verify** in Resend.
4. Drop SMTP credentials into `infra/.env` on the VPS:

   ```bash
   sed -i \
     -e 's|^AUTHENTIK_EMAIL_HOST=.*|AUTHENTIK_EMAIL_HOST=smtp.resend.com|' \
     -e 's|^AUTHENTIK_EMAIL_PORT=.*|AUTHENTIK_EMAIL_PORT=587|' \
     -e 's|^AUTHENTIK_EMAIL_USERNAME=.*|AUTHENTIK_EMAIL_USERNAME=resend|' \
     -e "s|^AUTHENTIK_EMAIL_PASSWORD=.*|AUTHENTIK_EMAIL_PASSWORD=$RESEND_KEY|" \
     -e 's|^AUTHENTIK_EMAIL_FROM=.*|AUTHENTIK_EMAIL_FROM=noreply@your-domain.com|' \
     /opt/esharevice/infra/.env
   docker compose -f /opt/esharevice/infra/docker-compose.yml restart authentik-server authentik-worker
   ```

5. Test from the Authentik admin UI: **System → Settings → Test Email Configuration**.

> Apple Sign-In is deferred until the mobile app phase (per plan v3.1).

---

## 9. Build and push the app images (15 min)

From your workstation (not the VPS):

```bash
# One-time: log in to ghcr.io
echo "$GITHUB_PAT" | docker login ghcr.io -u <YOUR-USERNAME> --password-stdin

# Build + push for the VPS architecture (linux/amd64 on Hetzner Intel boxes)
docker buildx build --platform linux/amd64 \
  -t ghcr.io/<OWNER>/esharevice-api:latest \
  -f apps/api/Dockerfile --push .

docker buildx build --platform linux/amd64 \
  -t ghcr.io/<OWNER>/esharevice-web:latest \
  -f apps/web/Dockerfile --push .
```

Either make the packages public in GitHub, **or** authenticate the VPS to ghcr.io with a PAT. Note: changing visibility on user-owned container packages is UI-only (`PATCH /user/packages/container/{pkg}` 404s even with full scopes) — for each package, visit `https://github.com/users/<OWNER>/packages/container/<pkg>/settings` → Danger Zone → Change visibility.

**To use private images (recommended):** create a fine-grained PAT at https://github.com/settings/tokens with `read:packages` scope (or just reuse a classic PAT with `repo`+`read:packages`), then on the VPS:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <OWNER> --password-stdin
# Credentials are stored in /home/ops/.docker/config.json (base64, not encrypted).
# Acceptable for a single-node deploy; wire `pass` or `secretservice` if you want a helper.
```

Back on the VPS:

```bash
cd /opt/esharevice/infra
docker compose pull api web
docker compose up -d api web
docker compose ps   # everything should be "running" + "healthy"
```

Smoke test:

```bash
curl -fsSL https://api.your-domain.com/health
curl -fsSL https://app.your-domain.com  | head -5
```

---

## 10. Apply Drizzle migrations (5 min)

The Postgres container ran `01-extensions.sql` (citext, pgcrypto) on first boot. Now apply the app schema:

```bash
cd /opt/esharevice
# Generate the SQL once on your workstation (commits go in packages/db/drizzle/):
pnpm --filter @esharevice/db db:generate

# Copy the migration files to the VPS as part of the repo (commit them); then run:
docker compose -f infra/docker-compose.yml exec api \
  pnpm --filter @esharevice/db db:migrate
```

---

## 11. Wire monitoring (10 min)

- **Uptime Kuma:** `https://uptime.your-domain.com`, sign in with the basic-auth user. Add monitors for `app/api/auth.your-domain.com` HTTPS, expected status 200/401. Configure a Discord / Slack / email notifier.
- **Sentry:** Create projects `esharevice-web` and `esharevice-api` in Sentry. Paste their DSNs into `infra/.env` as `SENTRY_DSN_WEB` / `SENTRY_DSN_API`, then `docker compose up -d web api`.

---

## 12. Schedule backups (5 min)

```bash
# 12.1 Install rclone + age
sudo apt-get install -y rclone age

# 12.2 Configure rclone B2 remote (interactive)
rclone config
#   → New remote → name=b2 → Backblaze B2 → paste account ID + app key

# 12.3 Drop the backup env file (root-only)
sudo tee /etc/esharevice-backup.env > /dev/null <<'EOF'
POSTGRES_PASSWORD=...                # match infra/.env
AUTHENTIK_POSTGRES_PASSWORD=...      # match infra/.env
AGE_RECIPIENT=age1...                # public key from your local age-keygen
B2_BUCKET=esharevice-backups
RETENTION_DAYS=30
AGE_IDENTITY_FILE=/root/.ssh/age-identity.key   # only needed for restore drills
EOF
sudo chmod 600 /etc/esharevice-backup.env

# 12.4 Cron daily backup at 03:00 UTC + quarterly restore drill
sudo crontab -e
#   0 3 *   *  *  /opt/esharevice/infra/scripts/backup.sh        >> /var/log/esharevice-backup.log 2>&1
#   0 4 1   */3 *  /opt/esharevice/infra/scripts/restore-drill.sh >> /var/log/esharevice-restore.log 2>&1

# 12.5 First run + verify a file lands in B2
sudo /opt/esharevice/infra/scripts/backup.sh
rclone ls b2:esharevice-backups/daily | tail
```

Mark a calendar reminder: **Restore drill in 90 days.**

---

## 13. Final acceptance checks

- [ ] `curl -fsSL https://app.your-domain.com` returns 200 with HTML
- [ ] `curl -fsSL https://api.your-domain.com/health` returns `{"status":"ok"}`
- [ ] `curl -I https://auth.your-domain.com` returns 200/302
- [ ] Authentik admin login works with TOTP/MFA enrolled
- [ ] `docker compose ps` shows all services `running` and `healthy`
- [ ] Uptime Kuma shows all monitors green
- [ ] One `pg_dump` artifact exists in B2 under `daily/<today>/`
- [ ] `restore-drill.sh` ran once successfully (run it manually before scheduling)
- [ ] Sentry receives a test event from both projects
- [ ] `Repo/` on the local workstation is **untouched** (this runbook never references it)

---

## Notes & gotchas

- **Authentik first boot is slow** (~60 s) because it runs migrations against a fresh DB. Don't restart the container during this window.
- **Coolify and Caddy both want ports 80/443** — only one can own them. If you use Coolify, configure it to NOT manage the proxy and let the Compose Caddy own the edge. (Coolify Settings → Reverse Proxy → None.)
- **HTTP/3 requires UDP 443** in the firewall and in Hetzner's cloud-firewall — both must allow it.
- **Restore drill is the single most important quality gate**. If it ever fails, treat it as a P0.
- **Image dedup logic** (sha256 → R2 key) lands in week 4. Until then, `uploads/` is local in the api container; do not lose the volume.

---

## Progress Log

### 2026-05-12 04:00 UTC
- Runbook drafted. Ready to follow when the user provisions an actual Hetzner box.
