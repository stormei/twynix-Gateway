# Edge Gateway (Node.js + TypeScript) — Fixed

A robust boilerplate for a ThingsBoard-compatible edge gateway:
- MQTT with store-and-forward (SQLite), QoS 1, reconnect, last-will
- OPC UA (Kepware) subscribe + read/write
- Config as local `config.json` and mirrored to ThingsBoard **client attributes** (`edge.config`)
- RPC methods (`writeTag`, `readTag`, `applyConfig`)
- Shared attributes hook: apply `edge.desiredConfig` to rewrite local config and push back as client attributes
- Built-in admin UI with login, status, MQTT/ThingsBoard settings, and OPC UA settings

## Quick start
```bash
cp .env.example .env
npm i
npm run build
npm start
```

Open `http://localhost:8080/` for the admin UI. Login credentials are read from `.env`:
```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

The UI saves directly to `config.json` and applies changes to the running gateway.
You can also change the admin password from the Web UI. Once changed, the password is stored in `.env` as `ADMIN_PASSWORD_HASH=...` instead of plaintext.

## Redeploy config from TB
Write a shared attribute:
```json
{
  "edge": {
    "desiredConfig": {
      "opcua": { "samplingMs": 200 },
      "mapping": [
        {"key":"Enable","nodeId":"ns=2;s=...Enable","type":"Boolean","writable":true}
      ]
    }
  }
}
```
The gateway persists to `config.json` and confirms via client attributes `edge.config`.

## Docker

The container stores mutable runtime state under `/data`:
- `/data/config.json`
- `/data/messages.db`
- `/data/rpc-journal.db`
- `/data/logs/gateway.log`

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
DEVICE_NAME=Machine02
TB_MQTT_URL=mqtt://YOUR_THINGSBOARD_HOST:1883
TB_ACCESS_TOKEN=YOUR_GATEWAY_DEVICE_TOKEN
MQTT_CLIENT_ID=edge-gw-01
OPCUA_URL=opc.tcp://YOUR_OPCUA_SERVER:49320
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH_FILE=/data/admin-password-hash
ADMIN_PASSWORD=...
```

For Docker you can either set `ADMIN_PASSWORD`, set `ADMIN_PASSWORD_HASH`, or leave both empty. If both are empty, the container generates a random admin password and prints it once in `docker compose logs`.

Leave `ADMIN_COOKIE_SECURE=false` when using the local admin UI over plain HTTP, for example `http://192.168.1.155:8080`. Set it to `true` only when the gateway is served behind HTTPS.

If you want to generate a hash manually:

```bash
node --input-type=module -e "import crypto from 'crypto'; const p=process.argv[1]; const s=crypto.randomBytes(16).toString('hex'); console.log('scrypt$'+s+'$'+crypto.scryptSync(p,s,64).toString('hex'))" 'ChangeMeInPoc123!'
```

Start the gateway:

```bash
mkdir -p data certs
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose logs -f twynix-gateway
```

The admin UI header shows the running version as `APP_VERSION+BUILD_SHA`. If the header still shows an old SHA after rebuild, the browser/container is not using the image you just built.

The gateway also checks the saved `CONFIG_PATH` periodically, controlled by `CONFIG_RECONCILE_INTERVAL_MS`. If the file contains newer MQTT or OPC UA settings than the active runtime, it logs `Saved config differs from active runtime; applying stored config` and reapplies the stored config.

The admin UI includes an authenticated **Debug** page with redacted recent logs, runtime status, OPC UA diagnostics, MQTT status, and sanitized config metadata. The same data is available over authenticated endpoints:

```text
GET /api/debug
GET /api/logs?limit=200&level=warn&q=opcua
```

If you change the admin password from the UI while running Docker, the new hash is written to `/data/admin-password-hash` and will be reused on the next container restart.
To reset a generated password, stop the container, delete `data/admin-password-hash`, and start it again.

Open the local admin UI:

```text
http://localhost:8080/
```

Health endpoints:

```bash
curl http://localhost:8080/readyz
curl http://localhost:8080/healthz
curl http://localhost:8080/metrics
```

For mapped ThingsBoard devices, the gateway device identified by `TB_ACCESS_TOKEN` must be marked as a ThingsBoard Gateway. Mapped-device telemetry is published through the ThingsBoard Gateway MQTT API and routes by exact target device name.

If the OPC UA server or ThingsBoard broker is only reachable on the host LAN, keep the default bridge network on Docker Desktop. On Linux you can alternatively enable `network_mode: host` in `docker-compose.yml` and remove the explicit `ports` mapping.
