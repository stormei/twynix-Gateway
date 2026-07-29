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

## OPC UA alarms to ThingsBoard

The gateway can subscribe to full OPC UA Alarm & Condition events and create, update, acknowledge, and
clear ThingsBoard alarms directly. ThingsBoard alarm rules are not required for this mode.

Requirements:

- An OPC UA server exposing `AlarmConditionType` conditions through the Server event notifier.
- ThingsBoard 4.3 or later for long-lived REST API keys.
- A scoped ThingsBoard API key allowed to read devices and manage alarms.
- Each mapped OPC UA source should have a ThingsBoard target device ID or exact device name. Unmapped
  alarm sources use `TB_ALARM_DEFAULT_DEVICE_NAME`.

Enable the integration in `.env`:

```bash
OPCUA_ALARMS_ENABLED=true
TB_ALARM_SYNC_ENABLED=true
TB_REST_URL=http://YOUR_THINGSBOARD_HOST:8080
TB_API_KEY=YOUR_SCOPED_API_KEY
TB_ALARM_DEFAULT_DEVICE_NAME=Machine001
```

The same settings are available under **Connectivity → Alarms** in the admin UI. This page also
exposes the REST request timeout and applies the OPC UA and ThingsBoard alarm settings together.

The gateway performs an OPC UA Condition Refresh after connection and reconnection. Active conditions
are restored in ThingsBoard, and stale gateway-managed ThingsBoard alarms are cleared when they are no
longer present in the refreshed OPC UA condition set.

Severity mapping:

```text
OPC UA >= 900  -> ThingsBoard CRITICAL
OPC UA >= 800  -> ThingsBoard MAJOR
OPC UA >= 600  -> ThingsBoard WARNING
OPC UA >= 300  -> ThingsBoard MINOR
lower/unknown  -> ThingsBoard INDETERMINATE
```

Acknowledging an alarm in ThingsBoard is polled back to OPC UA every five seconds. The gateway also
accepts this server-side RPC:

```json
{
  "method": "acknowledgeAlarm",
  "params": {
    "conditionId": "ns=1;s=A1.L1.M1.Temperature.Alarm",
    "comment": "Checked by operator"
  }
}
```

The REST API key is a secret. It is removed from redacted backups and diagnostic configuration summaries.

## RPC writes

Use the same `writeTag` contract for the gateway device and mapped ThingsBoard devices:

```json
{
  "method": "writeTag",
  "params": {
    "key": "Vanning",
    "value": true
  }
}
```

For a mapped device, `params.key` must exactly match a writable mapping `key`, and the mapping target must match the ThingsBoard device receiving the RPC. Existing mapping-specific methods configured through `write.rpcMethod` remain supported for backward compatibility.

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

Buffered MQTT replay can be throttled to protect ThingsBoard rule chains and downstream sinks such as IoTDB during reconnect recovery:

```bash
MQTT_FLUSH_BATCH_SIZE=50
MQTT_FLUSH_DELAY_MS=250
MQTT_FLUSH_INTERVAL_MS=15000
```

`MQTT_FLUSH_BATCH_SIZE` controls how many persisted messages are replayed at once. `MQTT_FLUSH_DELAY_MS` waits between replay batches. `MQTT_FLUSH_INTERVAL_MS` controls the periodic background flush interval.

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
