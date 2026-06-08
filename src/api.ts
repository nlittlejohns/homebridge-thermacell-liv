import type { Logger } from 'homebridge';

import {
  AUTH_LIFETIME_MS,
  DEFAULT_REFILL_TYPE,
  DEVICE_TYPE_LIV_HUB,
  MIN_REQUEST_INTERVAL_MS,
  parseDeviceState,
  type DeviceState,
} from './types.js';

const BASE_URL = 'https://api.iot.thermacell.com/v1';
const REQUEST_TIMEOUT_MS = 30_000;

export class ThermacellApiError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'ThermacellApiError';
  }
}

export class ThermacellAPI {
  private accessToken?: string;
  private userId?: string;
  private lastAuthenticatedAt = 0;
  private authPromise?: Promise<void>;
  private lastRequestAt = 0;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {}

  async login(): Promise<void> {
    await this.authenticate(true);
  }

  async getDevices(): Promise<DeviceState[]> {
    const nodesResponse = await this.request<{ nodes?: string[] }>('GET', '/user/nodes');
    const nodeIds = nodesResponse.nodes ?? [];

    if (nodeIds.length === 0) {
      this.log.warn(
        'No LIV hubs found. Verify your account uses ESP RainMaker hardware (LIV v1.5 or v2). LIV v1 is not supported.',
      );
      return [];
    }

    const devices: DeviceState[] = [];
    for (const nodeId of nodeIds) {
      const [params, status, config] = await Promise.all([
        this.request<Record<string, unknown>>('GET', '/user/nodes/params', { nodeid: nodeId }),
        this.request<Record<string, unknown>>('GET', '/user/nodes/status', { nodeid: nodeId }),
        this.request<Record<string, unknown>>('GET', '/user/nodes/config', { nodeid: nodeId }),
      ]);
      devices.push(parseDeviceState(nodeId, params, status, config));
    }

    return devices;
  }

  async setPower(nodeId: string, enabled: boolean): Promise<void> {
    await this.updateNodeParams(nodeId, {
      [DEVICE_TYPE_LIV_HUB]: {
        'Enable Repellers': enabled,
      },
    });
  }

  async setLedBrightness(nodeId: string, brightness: number): Promise<void> {
    await this.updateNodeParams(nodeId, {
      [DEVICE_TYPE_LIV_HUB]: {
        'LED Brightness': brightness,
      },
    });
  }

  async setLedColor(nodeId: string, hue: number, brightness: number): Promise<void> {
    await this.updateNodeParams(nodeId, {
      [DEVICE_TYPE_LIV_HUB]: {
        'LED Hue': hue,
        'LED Brightness': brightness,
      },
    });
  }

  async resetRefill(nodeId: string, refillType = DEFAULT_REFILL_TYPE): Promise<void> {
    await this.updateNodeParams(nodeId, {
      [DEVICE_TYPE_LIV_HUB]: {
        'Refill Reset': refillType,
      },
    });
  }

  private async updateNodeParams(nodeId: string, params: Record<string, unknown>): Promise<void> {
    await this.request('PUT', '/user/nodes/params', { nodeid: nodeId }, params);
  }

  private async authenticate(force: boolean): Promise<void> {
    if (!force && this.isAuthenticated() && !this.needsReauthentication()) {
      return;
    }

    if (this.authPromise) {
      await this.authPromise;
      if (!force && this.isAuthenticated() && !this.needsReauthentication()) {
        return;
      }
    }

    this.authPromise = this.performLogin();
    try {
      await this.authPromise;
    } finally {
      this.authPromise = undefined;
    }
  }

  private async performLogin(): Promise<void> {
    const response = await this.fetchWithTimeout(`${BASE_URL}/login2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_name: this.email,
        password: this.password,
      }),
    });

    if (response.status === 401) {
      throw new ThermacellApiError('Authentication failed: invalid credentials', response.status);
    }

    if (!response.ok) {
      throw new ThermacellApiError(`Authentication failed with status ${response.status}`, response.status);
    }

    const data = (await response.json()) as Record<string, string>;
    const accessToken = data.accesstoken;
    if (!accessToken) {
      throw new ThermacellApiError('Authentication response missing access token');
    }

    this.accessToken = accessToken;
    this.userId = this.extractUserId(data.idtoken);
    this.lastAuthenticatedAt = Date.now();
    this.log.info('Thermacell authentication successful%s', this.userId ? ` for user ${this.userId}` : '');
  }

  private async request<T>(
    method: string,
    endpoint: string,
    query?: Record<string, string>,
    body?: Record<string, unknown>,
    retryAuth = true,
  ): Promise<T> {
    await this.enforceRateLimit();
    await this.authenticate(false);

    const url = new URL(`${BASE_URL}${endpoint}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await this.fetchWithTimeout(url.toString(), {
      method,
      headers: {
        'Authorization': this.accessToken ?? '',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (retryAuth && (response.status === 401 || response.status === 403)) {
      this.log.warn('Thermacell API returned %s, re-authenticating', response.status);
      await this.authenticate(true);
      return this.request<T>(method, endpoint, query, body, false);
    }

    if (!response.ok) {
      throw new ThermacellApiError(`Thermacell API request failed: ${method} ${endpoint} (${response.status})`, response.status);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  private async enforceRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ThermacellApiError('Thermacell API request timed out');
      }
      throw new ThermacellApiError(`Thermacell API connection error: ${String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private isAuthenticated(): boolean {
    return Boolean(this.accessToken);
  }

  private needsReauthentication(): boolean {
    if (!this.lastAuthenticatedAt) {
      return true;
    }
    return Date.now() - this.lastAuthenticatedAt >= AUTH_LIFETIME_MS;
  }

  private extractUserId(idToken?: string): string | undefined {
    if (!idToken) {
      return undefined;
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return undefined;
    }

    try {
      const payload = parts[1];
      const padding = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
      const decoded = Buffer.from(payload + padding, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as Record<string, string>;
      return parsed['custom:user_id'];
    } catch {
      return undefined;
    }
  }
}
