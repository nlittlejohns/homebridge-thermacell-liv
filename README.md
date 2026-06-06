# homebridge-thermacell-liv

Homebridge plugin for **Thermacell LIV v2** mosquito repeller hubs via the ESP RainMaker cloud API (`api.iot.thermacell.com`).

LIV v1 and v1.5 hardware (legacy Ayla Networks backend) is **not supported**.

## Features

Each hub on your Thermacell account is exposed as a HomeKit accessory with:

| HomeKit service | Purpose |
|---|---|
| Switch | Turn repellers on/off (`Enable Repellers`) |
| Lightbulb | Control hub LED color and brightness |
| Humidity Sensor | Refill life percentage (pragmatic mapping) |
| Occupancy Sensor | Active when repeller is warming up or protecting |
| Stateless Programmable Switch | Reset refill cartridge counter |

## Requirements

- Homebridge ≥ 1.6.0
- Node.js ≥ 18 LTS
- Thermacell LIV v2 hub(s) linked to your Thermacell app account
- Internet connectivity (cloud-only; no local API)

## Installation

```bash
sudo npm install -g homebridge-thermacell-liv
```

## Configuration

Add a platform block to `config.json`:

```json
{
  "platforms": [
    {
      "name": "Thermacell LIV",
      "platform": "ThermacellLIV",
      "email": "your-thermacell-account-email",
      "password": "your-thermacell-password",
      "pollInterval": 60,
      "refillCartridgeType": 1
    }
  ]
}
```

| Option | Description |
|---|---|
| `email` | Thermacell app login email (required) |
| `password` | Thermacell app login password (required) |
| `pollInterval` | State refresh interval in seconds (30–300, default 60) |
| `refillCartridgeType` | Cartridge type for refill reset: 0 = 40hr, 1 = 100hr (default), 2 = 180hr |

## Limitations

- **Cloud-only:** All control and status requires internet access.
- **Polling:** State updates on the configured interval; there is no push API.
- **Auth:** Tokens are refreshed by re-login on expiry or 401 responses. If credentials are invalid, update config and restart Homebridge.
- **LED saturation:** Saturation is displayed from the device but never written to the API (writing saturation can crash the hub firmware).

## Development

```bash
git clone https://github.com/nlittlejohns/homebridge-thermacell-liv.git
cd homebridge-thermacell-liv
npm install
npm run build
npm link
```

Edit `test/hbConfig/config.json` with your credentials, then:

```bash
npm run watch
```

## Reference

- [joyfulhouse/thermacell_liv](https://github.com/joyfulhouse/thermacell_liv) — Home Assistant integration
- [joyfulhouse/pythermacell](https://github.com/joyfulhouse/pythermacell) — Python API client

## License

Apache-2.0
