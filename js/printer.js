// Thin wrapper around PocketPrinter5890 for the booth: one printer, one job at a time.

import { PocketPrinter, WebBluetoothTransport } from '../vendor/pocketprinter5890/index.js';

export class BoothPrinter {
  constructor({ onStatus, onProgress } = {}) {
    this.onStatus = onStatus ?? (() => {});
    this.onProgress = onProgress ?? (() => {});
    this.name = null;
    this.printer = new PocketPrinter(new WebBluetoothTransport(), {}, {
      onInfo: () => this.onStatus(this.status),
      onProgress: (fraction) => this.onProgress(fraction),
      onDisconnect: () => {
        this.name = null;
        this.onStatus(this.status);
      },
    });
  }

  static get isSupported() {
    return WebBluetoothTransport.isSupported;
  }

  get isConnected() {
    return this.printer.isConnected;
  }

  get status() {
    return {
      connected: this.isConnected,
      name: this.name,
      battery: this.printer.info.battery,
    };
  }

  /** Must be called from a user gesture (opens Chrome's device chooser). */
  async connect() {
    const device = await this.printer.connect();
    this.name = device.name;
    this.onStatus(this.status);
    // Battery and firmware arrive asynchronously through onInfo.
    this.printer.readDeviceInformation().catch((error) => console.warn('Device info failed', error));
    return device;
  }

  async disconnect() {
    if (this.isConnected) await this.printer.disconnect();
  }

  async print(bitmap, density) {
    await this.printer.printBitmap(bitmap, { density, trailingFeedDots: 100 });
  }
}
