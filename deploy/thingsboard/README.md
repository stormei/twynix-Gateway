# ThingsBoard OPC UA alarm rule-chain deployment

The gateway publishes a normalized JSON value under the telemetry key
`twynix_opcua_alarm_event`. It uses the normal device or Gateway MQTT API, so the ThingsBoard
message originator is already the mapped machine device. No tenant JWT or API key is stored in the
gateway.

The versioned node settings and scripts are in
`opcua-alarm-rule-chain.manifest.json`. The manifest deliberately omits database IDs and canvas
coordinates, which differ between ThingsBoard installations. Configure the nodes in the UI using
the manifest values.

## Install

1. Open **Rule chains → Root Rule Chain** as a tenant administrator.
2. Keep the existing **Post telemetry → Save Timeseries** and Device Profile paths unchanged.
3. From the existing **Message Type Switch** node, add a second **Post telemetry** connection to
   **Check fields presence**.
4. Add the nodes in manifest order and copy each configuration/script exactly.
5. Connect the nodes using the `connections` section.
6. Save/apply the rule chain.
7. Enable both alarm switches in the gateway under **Connectivity → Alarms**.

Remove legacy `TB_API_KEY`, `TB_REST_URL`, and `TB_ALARM_SYNC_ENABLED` entries from the gateway
`.env`. Current `docker-compose.yml` also overrides the first two with empty values so an older
credential is not injected into the rebuilt container.

The **Create Alarm** node must have **Use message alarm data** enabled and **Overwrite alarm
details** disabled. This preserves the gateway-supplied type, severity, timestamps, and OPC UA
details. ThingsBoard uses originator plus alarm type as the active-alarm identity, so repeated
active messages update the same alarm. The **Clear Alarm** node resolves the same dynamic type with
`${data.alarmType}`.

If the configured gateway telemetry key is changed, update both `telemetryKey` and the
**Check fields presence** / unwrap scripts in the manifest.

## Verify

Trigger an OPC UA condition and confirm the gateway logs:

```text
Normalized OPC UA alarm event published for ThingsBoard rule chain
```

Query ThingsBoard using a short-lived tenant user JWT from an operator workstation (do not put
this token in the gateway):

```bash
curl -s \
  -H "X-Authorization: Bearer $TB_JWT_TOKEN" \
  "$TB_URL/api/alarms?searchStatus=ACTIVE&fetchOriginator=true" |
  jq '.data[] | select(.details.protocol == "OPC UA" or .details.schemaVersion == "twynix.opcua-alarm.v1")'
```

Return the condition to normal and repeat the query with `searchStatus=ANY`; the same alarm type
and originator should now have a cleared status.

## Acknowledgement

Native ThingsBoard acknowledgement does not automatically acknowledge the OPC UA condition. The
gateway still exposes the `acknowledgeAlarm` RPC. A separate `ALARM_ACK` rule-chain branch may call
that RPC using `details.conditionId` when bidirectional acknowledgement is required.
