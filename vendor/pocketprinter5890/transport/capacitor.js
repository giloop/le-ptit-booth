/**
 * Capacitor transport, for iOS and Android from web code.
 *
 * Depends on `@capacitor-community/bluetooth-le`, which is **not** a
 * dependency of this package: the plugin is injected so the library stays
 * usable in a plain browser without pulling Capacitor in.
 *
 * ```ts
 * import { BleClient } from '@capacitor-community/bluetooth-le';
 * const transport = new CapacitorTransport(BleClient);
 * ```
 *
 * Untested: this adapter is written against the plugin's documented API but
 * has not been run on a device.
 */
import { SERVICE_UUID_FULL, WRITE_UUID_FULL, NOTIFY_TX_UUID_FULL, NOTIFY_STATUS_UUID_FULL, } from './types.js';
export class CapacitorTransport {
    ble;
    deviceId;
    handlers = [];
    disconnectHandlers = [];
    maxChunkSize = 180;
    constructor(ble) {
        this.ble = ble;
    }
    get isConnected() {
        return this.deviceId !== undefined;
    }
    async connect() {
        await this.ble.initialize();
        const device = await this.ble.requestDevice({
            namePrefix: 'Mini Pocket Printer',
            optionalServices: [SERVICE_UUID_FULL],
        });
        await this.ble.connect(device.deviceId, () => {
            this.deviceId = undefined;
            this.disconnectHandlers.forEach((handler) => handler());
        });
        this.deviceId = device.deviceId;
        for (const uuid of [NOTIFY_TX_UUID_FULL, NOTIFY_STATUS_UUID_FULL]) {
            try {
                await this.ble.startNotifications(device.deviceId, SERVICE_UUID_FULL, uuid, (value) => {
                    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
                    this.handlers.forEach((handler) => handler(bytes));
                });
            }
            catch {
                // A missing characteristic is not fatal.
            }
        }
        return { id: device.deviceId, name: device.name ?? 'Unknown' };
    }
    async disconnect() {
        if (this.deviceId)
            await this.ble.disconnect(this.deviceId);
        this.deviceId = undefined;
    }
    async write(bytes) {
        if (!this.deviceId)
            throw new Error('Not connected');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        await this.ble.writeWithoutResponse(this.deviceId, SERVICE_UUID_FULL, WRITE_UUID_FULL, view);
    }
    onNotification(handler) {
        this.handlers.push(handler);
    }
    onDisconnect(handler) {
        this.disconnectHandlers.push(handler);
    }
}
