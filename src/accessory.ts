import type { PlatformAccessory } from 'homebridge';

import { apiHsvToHomeKit, homeKitHueSaturationBrightnessToApi } from './color.js';
import type { ThermacellLIVPlatform } from './platform.js';
import {
  clampPercent,
  computeLedPower,
  isStatusActive,
  mapSystemStatus,
  type AccessoryContext,
  type DeviceState,
  type HubParams,
} from './types.js';

export class ThermacellHubAccessory {
  private device: DeviceState;
  private readonly switchService;
  private readonly lightService;
  private readonly refillService;
  private readonly statusService;
  private readonly resetService;

  constructor(
    private readonly platform: ThermacellLIVPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    device: DeviceState,
  ) {
    this.device = device;
    this.accessory.context.nodeId = device.nodeId;
    this.accessory.context.device = device;

    const { Service, Characteristic } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Thermacell')
      .setCharacteristic(Characteristic.Model, device.model)
      .setCharacteristic(Characteristic.SerialNumber, device.serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion);

    this.switchService = this.accessory.getService(Service.Switch)
      ?? this.accessory.addService(Service.Switch);

    this.lightService = this.accessory.getServiceById(Service.Lightbulb, 'led')
      ?? this.accessory.addService(Service.Lightbulb, 'led', 'led');

    this.refillService = this.accessory.getServiceById(Service.HumiditySensor, 'refill-life')
      ?? this.accessory.addService(Service.HumiditySensor, 'Refill Life', 'refill-life');

    this.statusService = this.accessory.getServiceById(Service.OccupancySensor, 'status')
      ?? this.accessory.addService(Service.OccupancySensor, 'Status', 'status');

    this.resetService = this.accessory.getServiceById(Service.StatelessProgrammableSwitch, 'reset-refill')
      ?? this.accessory.addService(Service.StatelessProgrammableSwitch, 'Reset Refill', 'reset-refill');

    this.refillService.setCharacteristic(Characteristic.Name, `${device.name} Refill Life`);
    this.statusService.setCharacteristic(Characteristic.Name, `${device.name} Status`);

    this.registerHandlers();
    this.updateFromDevice(device);
  }

  private registerHandlers(): void {
    const { Characteristic } = this.platform;

    this.switchService.getCharacteristic(Characteristic.On)!
      .onGet(() => this.getPower())
      .onSet((value) => {
        void this.setPower(Boolean(value));
      });

    this.lightService.getCharacteristic(Characteristic.On)!
      .onGet(() => this.getLightOn())
      .onSet((value) => {
        void this.setLightOn(Boolean(value));
      });

    this.lightService.getCharacteristic(Characteristic.Brightness)!
      .onGet(() => this.getBrightness())
      .onSet((value) => {
        void this.setBrightness(Number(value));
      });

    this.lightService.getCharacteristic(Characteristic.Hue)!
      .onGet(() => this.getHue())
      .onSet((value) => {
        void this.setHue(Number(value));
      });

    this.lightService.getCharacteristic(Characteristic.Saturation)!
      .onGet(() => this.getSaturation())
      .onSet((value) => {
        void this.setSaturation(Number(value));
      });

    this.refillService.getCharacteristic(Characteristic.CurrentRelativeHumidity)!
      .onGet(() => this.getRefillLife());

    this.statusService.getCharacteristic(Characteristic.OccupancyDetected)!
      .onGet(() => this.getOccupancy());

    this.resetService.getCharacteristic(Characteristic.ProgrammableSwitchEvent)!
      .onSet((value) => {
        if (Number(value) === Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS) {
          void this.resetRefill();
        }
      });
  }

  updateFromDevice(device: DeviceState): void {
    this.device = device;
    this.accessory.context.device = device;
    this.accessory.displayName = device.name;

    const { Characteristic } = this.platform;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .updateCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion);

    this.switchService.updateCharacteristic(Characteristic.On, this.getPower());
    this.switchService.updateCharacteristic(Characteristic.StatusFault, this.getStatusFault());

    this.lightService.updateCharacteristic(Characteristic.On, this.getLightOn());
    this.lightService.updateCharacteristic(Characteristic.Brightness, this.getBrightness());
    this.lightService.updateCharacteristic(Characteristic.Hue, this.getHue());
    this.lightService.updateCharacteristic(Characteristic.Saturation, this.getSaturation());

    this.refillService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.getRefillLife());
    this.statusService.updateCharacteristic(Characteristic.OccupancyDetected, this.getOccupancy());
  }

  private getHub(): HubParams {
    return this.device.hub;
  }

  private getPower(): boolean {
    return Boolean(this.getHub()['Enable Repellers']);
  }

  private getStatusFault(): number {
    return (this.getHub().Error ?? 0) > 0
      ? this.platform.Characteristic.StatusFault.GENERAL_FAULT
      : this.platform.Characteristic.StatusFault.NO_FAULT;
  }

  private getBrightness(): number {
    return clampPercent(this.getHub()['LED Brightness']);
  }

  private getHue(): number {
    const hue = this.getHub()['LED Hue'] ?? 0;
    const saturation = this.getHub()['LED Saturation'] ?? 100;
    const brightness = this.getBrightness();
    return apiHsvToHomeKit(hue, saturation, brightness).hue;
  }

  private getSaturation(): number {
    const hue = this.getHub()['LED Hue'] ?? 0;
    const saturation = this.getHub()['LED Saturation'] ?? 100;
    const brightness = this.getBrightness();
    return apiHsvToHomeKit(hue, saturation, brightness).saturation;
  }

  private getLightOn(): boolean {
    if (!this.getPower()) {
      return false;
    }
    return computeLedPower(this.getHub()['Enable Repellers'], this.getHub()['LED Brightness']);
  }

  private getRefillLife(): number {
    return clampPercent(this.getHub()['Refill Life']);
  }

  private getOccupancy(): number {
    const status = mapSystemStatus(
      this.getHub()['System Status'],
      this.getHub()['Enable Repellers'],
      this.getHub().Error,
      this.device.online,
    );
    return isStatusActive(status)
      ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
  }

  private async setPower(value: boolean): Promise<void> {
    if (!this.device.online) {
      this.platform.log.warn('Cannot set power while %s is offline', this.device.name);
      return;
    }

    const previous = this.cloneDevice();
    this.applyLocalPower(value);
    this.pushLocalState();

    try {
      await this.platform.getApiClient().setPower(this.device.nodeId, value);
    } catch (error) {
      this.platform.log.warn('Failed to set power for %s: %s', this.device.name, String(error));
      this.device = previous;
      this.pushLocalState();
    }
  }

  private async setLightOn(value: boolean): Promise<void> {
    if (!this.device.online) {
      this.platform.log.warn('Cannot set LED while %s is offline', this.device.name);
      return;
    }

    const previous = this.cloneDevice();
    const brightness = value ? (this.getBrightness() > 0 ? this.getBrightness() : 100) : 0;
    this.applyLocalBrightness(brightness);
    this.pushLocalState();

    try {
      await this.platform.getApiClient().setLedBrightness(this.device.nodeId, brightness);
    } catch (error) {
      this.platform.log.warn('Failed to set LED power for %s: %s', this.device.name, String(error));
      this.device = previous;
      this.pushLocalState();
    }
  }

  private async setBrightness(value: number): Promise<void> {
    if (!this.device.online) {
      this.platform.log.warn('Cannot set LED brightness while %s is offline', this.device.name);
      return;
    }

    const previous = this.cloneDevice();
    const brightness = clampPercent(value);
    this.applyLocalBrightness(brightness);
    this.pushLocalState();

    try {
      await this.platform.getApiClient().setLedBrightness(this.device.nodeId, brightness);
    } catch (error) {
      this.platform.log.warn('Failed to set LED brightness for %s: %s', this.device.name, String(error));
      this.device = previous;
      this.pushLocalState();
    }
  }

  private async setHue(value: number): Promise<void> {
    await this.setLedColorFromHomeKit(value, this.getSaturation(), this.getBrightness());
  }

  private async setSaturation(value: number): Promise<void> {
    await this.setLedColorFromHomeKit(this.getHue(), value, this.getBrightness());
  }

  private async setLedColorFromHomeKit(hue: number, saturation: number, brightness: number): Promise<void> {
    if (!this.device.online) {
      this.platform.log.warn('Cannot set LED color while %s is offline', this.device.name);
      return;
    }

    const previous = this.cloneDevice();
    const apiValues = homeKitHueSaturationBrightnessToApi(hue, saturation, brightness);
    this.applyLocalLedColor(apiValues.hue, apiValues.brightness);
    this.pushLocalState();

    try {
      await this.platform.getApiClient().setLedColor(
        this.device.nodeId,
        apiValues.hue,
        apiValues.brightness,
      );
    } catch (error) {
      this.platform.log.warn('Failed to set LED color for %s: %s', this.device.name, String(error));
      this.device = previous;
      this.pushLocalState();
    }
  }

  private async resetRefill(): Promise<void> {
    if (!this.device.online) {
      this.platform.log.warn('Cannot reset refill while %s is offline', this.device.name);
      return;
    }

    const previousRefill = this.getRefillLife();
    this.device.hub['Refill Life'] = 100;
    this.pushLocalState();

    try {
      await this.platform.getApiClient().resetRefill(
        this.device.nodeId,
        this.platform.getRefillCartridgeType(),
      );
      this.platform.log.info('Refill reset requested for %s', this.device.name);
    } catch (error) {
      this.platform.log.warn('Failed to reset refill for %s: %s', this.device.name, String(error));
      this.device.hub['Refill Life'] = previousRefill;
      this.pushLocalState();
    }
  }

  private applyLocalPower(powerOn: boolean): void {
    this.device.hub['Enable Repellers'] = powerOn;
  }

  private applyLocalBrightness(brightness: number): void {
    this.device.hub['LED Brightness'] = brightness;
  }

  private applyLocalLedColor(hue: number, brightness: number): void {
    this.device.hub['LED Hue'] = hue;
    this.device.hub['LED Brightness'] = brightness;
  }

  private pushLocalState(): void {
    this.updateFromDevice(this.device);
  }

  private cloneDevice(): DeviceState {
    return structuredClone(this.device);
  }
}
