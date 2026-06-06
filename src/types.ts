export const DEVICE_TYPE_LIV_HUB = 'LIV Hub';

export const AUTH_LIFETIME_MS = 4 * 60 * 60 * 1000;

export const MIN_REQUEST_INTERVAL_MS = 500;

export const DEFAULT_REFILL_TYPE = 1;

export type SystemStatusText =
  | 'Not Connected'
  | 'Off'
  | 'Warming Up'
  | 'Protected'
  | 'Error'
  | 'Unknown';

export interface HubParams {
  'Enable Repellers'?: boolean;
  'LED Brightness'?: number;
  'LED Hue'?: number;
  'LED Saturation'?: number;
  'Refill Life'?: number;
  'System Status'?: number;
  'Error'?: number;
  'Name'?: string;
}

export interface DeviceState {
  nodeId: string;
  name: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  online: boolean;
  hub: HubParams;
}

export interface ThermacellConfig {
  name?: string;
  email: string;
  password: string;
  pollInterval?: number;
  refillCartridgeType?: number;
}

export interface AccessoryContext {
  nodeId: string;
  device?: DeviceState;
}

export function computeLedPower(enableRepellers: boolean | undefined, brightness: number | undefined): boolean {
  return Boolean(enableRepellers) && (brightness ?? 0) > 0;
}

export function mapSystemStatus(
  systemStatus: number | undefined,
  enableRepellers: boolean | undefined,
  error: number | undefined,
  online: boolean,
): SystemStatusText {
  if (!online) {
    return 'Not Connected';
  }
  if ((error ?? 0) > 0) {
    return 'Error';
  }
  if (!enableRepellers) {
    return 'Off';
  }
  if (systemStatus === 1) {
    return 'Off';
  }
  if (systemStatus === 2) {
    return 'Warming Up';
  }
  if (systemStatus === 3) {
    return 'Protected';
  }
  return 'Unknown';
}

export function isStatusActive(status: SystemStatusText): boolean {
  return status === 'Protected' || status === 'Warming Up';
}

export function clampPercent(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parseDeviceState(
  nodeId: string,
  paramsData: Record<string, unknown>,
  statusData: Record<string, unknown>,
  configData: Record<string, unknown>,
): DeviceState {
  const hubParams = (paramsData[DEVICE_TYPE_LIV_HUB] ?? {}) as HubParams;
  const info = (configData.info ?? {}) as Record<string, unknown>;
  const devices = Array.isArray(configData.devices) ? configData.devices : [{}];
  const deviceData = (devices[0] ?? {}) as Record<string, unknown>;
  const connectivity = (statusData.connectivity ?? {}) as Record<string, unknown>;

  const modelType = String(info.type ?? '');
  const model = modelType === 'thermacell-hub' ? 'Thermacell LIV Hub' : modelType || 'Thermacell LIV Hub';
  const serialNumber = String(deviceData.serial_num ?? 'unknown');
  const name = hubParams.Name ?? String(info.name ?? nodeId);

  return {
    nodeId,
    name: String(name),
    model,
    firmwareVersion: String(info.fw_version ?? 'unknown'),
    serialNumber: serialNumber === 'unknown' ? nodeId : serialNumber,
    online: Boolean(connectivity.connected),
    hub: hubParams,
  };
}
