# Run your own MarkMySteps server

English | [Nederlands](SELF-HOSTING.nl.md)

A server is just a computer that stays on. An old laptop with Linux is fine, and so is a Raspberry Pi or a NAS. You need Docker with `docker compose`. Everything below takes about ten minutes, plus the time to set up a public address if you want to reach the server from outside your home.

You do not need a server to use MarkMySteps. The Android app works on its own, and you can add a server later without entering anything again. A server is for travelling together, sharing, and a backup of your trips.

## 1. Install the server

```bash
git clone https://github.com/Marukiee/MarkMySteps.git && cd MarkMySteps && ./install.sh
```

The installer asks once for the public address you want to reach the app on (for example `https://trips.example.com`), makes all the keys, builds the containers, waits until the API is healthy and tells you what to fill in at Cloudflare.

The app runs on **port 18790**. That is unusual on purpose, so it does not clash with Home Assistant and the like. Want another port? Run `WEB_PORT=12345 ./install.sh` the first time, or change `WEB_PORT` in `.env` later and run `docker compose up -d`.

> **Never throw away or regenerate `.env`.** It holds the keys that keep your logins and encrypted Immich keys readable.

To check that everything runs:

```bash
docker compose ps                             # every service "healthy"
curl -s http://127.0.0.1:18790/api/health     # {"status":"ok","postgis":"..."}
```

## 2. Make the server reachable

After the installer, the app runs on `http://<server-ip>:18790`, only on your own network. To reach it from outside, and to make the Android app work away from home, you need a public HTTPS address. There are three ways, from easy to more work.

| Way | Open ports in your router | Good for |
| --- | --- | --- |
| [Cloudflare Tunnel](#cloudflare-tunnel-recommended) | None | Most people. Free certificate, works behind CGNAT |
| [Reverse proxy](#reverse-proxy-with-your-own-certificate) | 80 and 443 | You already run Caddy, Nginx Proxy Manager or Traefik |
| [Your own network only](#your-own-network-only) | None | Using it at home or over your own VPN |

### Cloudflare Tunnel (recommended)

No open ports in your router, a free HTTPS certificate, and it works behind CGNAT. You need a domain that is managed at Cloudflare.

If you have no tunnel yet:

```bash
# on the server
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login          # opens a browser link, choose your domain
```

Then in the dashboard, without a config file:

1. **Cloudflare Zero Trust** > **Networks > Tunnels** > your tunnel > tab **Public Hostname** > **Add a public hostname**.
2. Subdomain: for example `trips`. Domain: your own domain.
3. Service type: **HTTP**. URL: `localhost:18790`.
4. Save. The DNS record is made for you.

Leave `localhost` exactly as it is: cloudflared runs on the same server as Docker, so it points at the machine itself. Only if cloudflared runs on another machine do you fill in the LAN IP of the Docker server here. Never point DNS at a port: hostname > tunnel > `localhost:18790`.

Then put the same address in `.env` as `WEB_ORIGIN` (separated by commas if you have more than one) and run `docker compose up -d`. Without that the API refuses requests from your own site, because CORS is an allowlist.

Done: `https://trips.example.com`.

You can put Cloudflare Access in front too, but then the Android app can no longer reach the API, because it does not send a browser login.

**What you may run into.** A tunnel is free and unlimited in traffic, but there are limits on what goes through. These are for the free plan and Cloudflare changes them now and then, so check their docs if something fails.

| Limit | Value | What you notice |
| --- | --- | --- |
| Size of one upload | 100 MB | A bigger Polarsteps zip is refused with a 413 |
| Time until your server starts to answer | 100 seconds | A longer import gives error 524 |
| Tunnels per account | 1000 | More than enough |
| Hostnames per tunnel | unlimited | Immich and MarkMySteps can share a tunnel |

The Polarsteps import has its own limit of 100 MB, right at that first line. If your export is bigger, import while you are at home on `http://<server-ip>:18790` (the tunnel is not used then), or split the zip.

Also mind the terms of use: pumping video in bulk through the free network is not what Cloudflare intends. MarkMySteps streams videos from your Immich server through the tunnel, so if you have a lot of videos and watch them often from outside, use the reverse proxy below or a VPN.

### Reverse proxy with your own certificate

Already running Caddy, Nginx Proxy Manager or Traefik? Point it at `localhost:18790`. In Caddy that is one block:

```
trips.example.com {
	reverse_proxy localhost:18790
}
```

Ports 80 and 443 must be open in your router. Set `WEB_ORIGIN` in `.env` to your public address here too.

### Your own network only

You can also keep the port closed and use `http://<server-ip>:18790` at home, or over your own VPN (WireGuard, Tailscale). Tracking keeps working: the app buffers everything it records on the road and uploads it when you are in range again.

## 3. First use

1. Open the site and choose **Create account**.
2. **Settings > Immich**: server address and API key (in Immich: Account settings > API keys), then **Connect**. If your Immich is on an internal address, first allow it in `.env` (see [Allow an internal Immich address](#allow-an-internal-immich-address)).
3. **Settings > Import from Polarsteps**: upload your zip (polarsteps.com > Settings > Privacy > *Download my data*). You get your trip back with the full GPS route and stops.
4. Open a trip: map, timeline, **Planning** (drag stops, nights +/-), **Sync photos** and **Start tracking**.

### Allow an internal Immich address

The server fetches photos from the Immich address someone enters. If that could be any address, a logged in account could make the server talk to anything that only the server can reach: the router, other containers, admin pages on your network. So addresses on a private network are refused (`192.168.x.x`, `10.x.x.x`, `172.16 to 31.x.x`, Tailscale `100.64.x.x`, `localhost`), unless you allow them yourself. A public address (`https://photos.example.com`) works without doing anything.

If your Immich runs on such an internal address, put the host (without the port) in `.env`, several separated by commas:

```bash
IMMICH_ALLOWED_HOSTS=192.168.0.10
```

Then run `docker compose up -d` (it restarts the API). Without this line *Connect* gives an error, and loading and syncing photos from an internal address fails with "Could not reach the Immich server".

## Install the Android app

1. Download `markmysteps.apk` from the [latest release](https://github.com/Marukiee/MarkMySteps/releases/latest) on your phone.
2. Open it. Android asks once whether the app you open it with may install apps from unknown sources. Turn that on, go back and tap Install.
3. Open the app and choose **Continue without a server**, or enter your server address and log in.
4. Open a trip and tap **Start tracking**. Give the location permission, then set it to **Allow all the time** in Android settings > Apps > MarkMySteps > Location. That is needed for tracking with the screen off.

Battery: the app only asks for a GPS fix after 50 m of movement, buffers offline and uploads when there is a network again. It works without Google Play Services (LineageOS, GrapheneOS).

## Keeping it up

### Update

```bash
cd ~/MarkMySteps
git pull
./install.sh                     # migrations run by themselves on start
```

`install.sh` builds the new images first while the old site keeps running. Only when that succeeded does the app go down for a moment, and while it does, visitors get a maintenance page ("MarkMySteps will be right back") instead of a browser error. If the new version fails, that page stays until you have fixed it.

When you are working on the server yourself, you can turn that page on and off by hand:

```bash
./maintenance.sh on
./maintenance.sh off
```

### Back up

The database is all your data.

```bash
cd ~/MarkMySteps
docker compose exec db pg_dump -U markmysteps markmysteps | gzip > ~/mms-backup-$(date +%F).sql.gz
```

Keep `.env` safe as well: without it a backup of the database cannot be read.

### Remove

```bash
cd ~/MarkMySteps && ./uninstall.sh
```

This only removes the MarkMySteps containers, images and the internal network. The rest of the server (Immich, Home Assistant, cloudflared) is left alone. The script asks separately whether you also want to delete the database volume (all your data). If you keep it, a new install with the same `.env` picks your data up again.

## Good to know

### Limits

The server is meant for you and the people you travel with, not for the open internet. You see that in the limits that are fixed:

| What | Limit |
| --- | --- |
| All requests together | 300 per minute, per session (per IP without a login) |
| Logging in, registering, changing a password | 5 per minute |
| Opening a share link with a password | 10 per minute |
| Creating a share link | 10 per minute |
| Syncing photos | 6 per minute per trip |
| Uploading track points | 30 per minute (bundles of 500 points) |
| Thumbnails | 600 per minute (1200 on a share page) |
| Videos | 120 per minute |
| Open registration requests | 15 at the same time |
| Profile photo | 2 MB |
| Polarsteps zip | 100 MB |
| Access token | 15 minutes (renews itself) |
| Remember me | 30 days |
| Share link session | 7 days, and gone at once when you revoke the link |

Also: the database has no port to the outside, photos stay on your Immich server (MarkMySteps only keeps references), and your Immich API key goes into the database encrypted with the key from `.env`.

### Two step verification and security alerts

Every account can protect itself with a code from an authenticator app (Proton Authenticator, Aegis, Google Authenticator and others): **Settings > Profile > Two step verification**. When you turn it on you scan a QR code and get ten recovery codes that you see once. Each recovery code works once, for when you lose your phone. Turning it off and making new recovery codes ask for the password and a code.

- A code works once: using the same code again within thirty seconds is refused.
- If someone lost their phone and their recovery codes, an admin can turn off 2FA for that account (**Settings > Accounts > Reset 2FA**). That person is logged out everywhere.
- An older version of the Android app does not know the second step. Whoever turns on 2FA must update the app first.

Anyone who keeps trying an account is locked out, whatever address they come from: after 10 wrong passwords or 5 wrong codes that account is closed for a quarter of an hour. That also holds for names that do not exist, so it tells nobody who has an account. At that moment all admins get a message under the bell (and on their phone) that someone is trying to break in. The counter lives in the memory of the API, so a restart clears it.

## Build it yourself

Needs Node 22 or newer, pnpm and Docker.

```bash
git clone https://github.com/Marukiee/MarkMySteps.git
cd MarkMySteps
pnpm install
docker compose -f docker-compose.dev.yml up -d

cat > apps/api/.env <<EOF
DATABASE_URL=postgresql://markmysteps:dev-only-password@localhost:5432/markmysteps?schema=public
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
MASTER_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
WEB_ORIGIN=http://localhost:5173
API_PORT=3000
EOF

pnpm --filter @markmysteps/api db:generate
pnpm --filter @markmysteps/api db:deploy
pnpm dev        # API :3000 + web :5173
```
