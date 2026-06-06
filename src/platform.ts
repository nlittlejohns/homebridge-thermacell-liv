import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { ThermacellHubAccessory } from './accessory.js';
import { ThermacellAPI, ThermacellApiError } from './api.js';
import {
  DEFAULT_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  MIN_POLL_INTERVAL,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './settings.js';
import type { AccessoryContext, ThermacellConfig } from './types.js';

export class ThermacellLIVPlatform implements DynamicPlatformPlugin {
  public readonly accessories = new Map<string, PlatformAccessory<AccessoryContext>>();
  private readonly handlers = new Map<string, ThermacellHubAccessory>();
  private readonly discoveredCacheUUIDs: string[] = [];
  private pollTimer?: NodeJS.Timeout;
  private readonly apiClient: ThermacellAPI;
  private readonly platformConfig: ThermacellConfig;
  private isDiscovering = false;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.platformConfig = config as unknown as ThermacellConfig;

    if (!this.platformConfig.email || !this.platformConfig.password) {
      this.log.error('Thermacell LIV platform requires email and password in config.json');
      this.apiClient = new ThermacellAPI('', '', this.log);
      return;
    }

    this.apiClient = new ThermacellAPI(
      this.platformConfig.email,
      this.platformConfig.password,
      this.log,
    );

    this.api.on('didFinishLaunching', () => {
      void this.startPlatform();
    });
  }

  get Service() {
    return this.api.hap.Service;
  }

  get Characteristic() {
    return this.api.hap.Characteristic;
  }

  configureAccessory(accessory: PlatformAccessory<AccessoryContext>): void {
    this.log.info('Restoring accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private async startPlatform(): Promise<void> {
    if (!this.platformConfig.email || !this.platformConfig.password) {
      return;
    }

    try {
      await this.apiClient.login();
      await this.discoverDevices();
      this.startPolling();
    } catch (error) {
      this.log.error('Failed to start Thermacell LIV platform: %s', this.formatError(error));
      this.setAllReachability(false);
    }
  }

  private startPolling(): void {
    const pollInterval = this.getPollInterval();
    this.log.info('Starting Thermacell device polling every %s seconds', pollInterval);

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(() => {
      void this.discoverDevices();
    }, pollInterval * 1000);
  }

  private getPollInterval(): number {
    const configured = this.platformConfig.pollInterval ?? DEFAULT_POLL_INTERVAL;
    return Math.max(MIN_POLL_INTERVAL, Math.min(MAX_POLL_INTERVAL, configured));
  }

  private async discoverDevices(): Promise<void> {
    if (this.isDiscovering) {
      return;
    }

    this.isDiscovering = true;
    this.discoveredCacheUUIDs.length = 0;

    try {
      const devices = await this.apiClient.getDevices();

      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(device.nodeId);
        this.discoveredCacheUUIDs.push(uuid);

        const existingAccessory = this.accessories.get(uuid);
        if (existingAccessory) {
          existingAccessory.context.nodeId = device.nodeId;
          existingAccessory.context.device = device;
          existingAccessory.displayName = device.name;

          let handler = this.handlers.get(uuid);
          if (!handler) {
            handler = new ThermacellHubAccessory(this, existingAccessory, device);
            this.handlers.set(uuid, handler);
          } else {
            handler.updateFromDevice(device);
          }
          continue;
        }

        this.log.info('Adding new accessory:', device.name);
        const accessory = new this.api.platformAccessory<AccessoryContext>(device.name, uuid);
        accessory.context = {
          nodeId: device.nodeId,
          device,
        };

        this.accessories.set(uuid, accessory);
        const handler = new ThermacellHubAccessory(this, accessory, device);
        this.handlers.set(uuid, handler);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      for (const [uuid, accessory] of this.accessories.entries()) {
        if (!this.discoveredCacheUUIDs.includes(uuid)) {
          this.log.info('Removing stale accessory:', accessory.displayName);
          this.handlers.delete(uuid);
          this.accessories.delete(uuid);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      if (error instanceof ThermacellApiError && error.statusCode === 401) {
        this.log.error('Thermacell authentication failed. Update email/password in plugin config and restart Homebridge.');
      } else {
        this.log.warn('Thermacell discovery failed: %s', this.formatError(error));
      }
      this.setAllReachability(false);
    } finally {
      this.isDiscovering = false;
    }
  }

  private setAllReachability(reachable: boolean): void {
    for (const handler of this.handlers.values()) {
      handler.setReachability(reachable);
    }
  }

  getApiClient(): ThermacellAPI {
    return this.apiClient;
  }

  getRefillCartridgeType(): number {
    const value = this.platformConfig.refillCartridgeType ?? 1;
    if (value >= 0 && value <= 2) {
      return value;
    }
    return 1;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
