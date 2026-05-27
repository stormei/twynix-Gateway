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
ADMIN_PASSWORD_HASH=...
ADMIN_PASSWORD_HASH_FILE=/data/admin-password-hash
```

Generate an admin password hash:

```bash
node --input-type=module -e "import crypto from 'crypto'; const p=process.argv[1]; const s=crypto.randomBytes(16).toString('hex'); console.log('scrypt$'+s+'$'+crypto.scryptSync(p,s,64).toString('hex'))" 'ChangeMeInPoc123!'
```

Start the gateway:

```bash
mkdir -p data certs
docker compose up -d --build
docker compose logs -f twynix-gateway
```

If you change the admin password from the UI while running Docker, the new hash is written to `/data/admin-password-hash` and will be reused on the next container restart.

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
