/**
 * Main entry point.
 *
 * Wraps a transport with the protocol logic: activation sequence, credit
 * flow control, chunking, response decoding.
 */
import * as cmd from './protocol/commands.js';
import { PrinterStatus } from './protocol/commands.js';
import { CreditFlowController } from './protocol/flow-control.js';
import { decode } from './protocol/responses.js';
import { buildSegments, defaultOptions } from './protocol/job.js';
import { PrintDocument } from './protocol/document.js';
import * as escpos from './protocol/escpos.js';
export class PocketPrinter {
    transport;
    events;
    flow = new CreditFlowController();
    info = {};
    options;
    constructor(transport, options = {}, events = {}) {
        this.transport = transport;
        this.events = events;
        this.options = { ...defaultOptions, ...options };
        this.transport.onNotification((bytes) => this.handleNotification(bytes));
        this.transport.onDisconnect(() => this.handleDisconnect());
    }
    get isConnected() {
        return this.transport.isConnected;
    }
    /**
     * Bytes per BLE write.
     *
     * The vendor app negotiates an MTU up to 512; 180 is reliable. Lowering it
     * to 20, the BLE minimum, works but is very slow.
     */
    get transportChunkSize() {
        return this.transport.maxChunkSize;
    }
    set transportChunkSize(value) {
        this.transport.maxChunkSize = value;
    }
    /** Whether credit-based pacing is applied. Disable only for comparison. */
    get useFlowControl() {
        return this.flow.enabled;
    }
    set useFlowControl(value) {
        this.flow.enabled = value;
    }
    async connect() {
        const device = await this.transport.connect();
        // Stale credits from a previous session are meaningless.
        this.flow.reset();
        return device;
    }
    async disconnect() {
        await this.transport.disconnect();
        this.handleDisconnect();
    }
    /**
     * Clears every piece of session state.
     *
     * Credits and device information belong to one connection: carrying them
     * across makes a reconnected printer look like it still owes packets, and
     * the next job stalls waiting for credit that will never come.
     */
    handleDisconnect() {
        this.flow.reset();
        delete this.info.model;
        delete this.info.firmware;
        delete this.info.battery;
        delete this.info.status;
        this.events.onDisconnect?.();
    }
    // --- Printing
    /** Prints a composed document. */
    async print(document, options) {
        const segments = buildSegments(document, { ...this.options, ...options });
        const total = segments.reduce((sum, segment) => sum + segment.bytes.length, 0);
        let sent = 0;
        for (const segment of segments) {
            await this.send(new Uint8Array(segment.bytes));
            sent += segment.bytes.length;
            this.events.onProgress?.(total > 0 ? sent / total : 1);
        }
    }
    /** Prints a bitmap on its own. */
    async printBitmap(bitmap, options) {
        await this.print(new PrintDocument().image(bitmap), options);
    }
    /** Prints one or more lines of text. */
    async printText(text, options = {}) {
        const document = new PrintDocument();
        for (const line of text.split('\n')) {
            document.text(line, options);
        }
        await this.print(document);
    }
    /**
     * Feeds paper without printing.
     *
     * Wrapped in the activation sequence: a bare feed command is acknowledged
     * and ignored, like every command sent outside a job.
     */
    async feed(dots) {
        await this.runActivated(escpos.feed(dots));
    }
    // --- Settings and information
    async readDeviceInformation() {
        await this.runActivated([
            ...cmd.READ_MODEL,
            ...cmd.READ_FIRMWARE,
            ...cmd.READ_BATTERY,
            ...cmd.READ_STATUS,
        ]);
    }
    async setDensity(density) {
        this.options.density = density;
        await this.runActivated(cmd.setDensity(density));
    }
    /**
     * Sets the auto power-off delay, in minutes.
     *
     * UNVERIFIED on this firmware, including whether 0 disables it. Read back
     * with {@link readSettings} to see what was stored.
     */
    async setAutoShutdown(minutes) {
        await this.runActivated(cmd.setAutoShutdown(minutes));
    }
    async readSettings() {
        await this.runActivated([
            ...cmd.READ_DENSITY,
            ...cmd.READ_SPEED,
            ...cmd.READ_AUTO_SHUTDOWN,
        ]);
    }
    /**
     * Escape hatch for a command the library does not cover.
     *
     * Sends raw bytes with no activation sequence around them. Most commands
     * need one — see {@link runActivated}.
     */
    async sendCommand(bytes) {
        await this.send(new Uint8Array(bytes));
    }
    /**
     * Runs commands inside the activation sequence.
     *
     * The firmware acknowledges everything it receives but executes nothing
     * until it has been enabled and woken. This applies to reads and paper
     * feeds just as much as to printing.
     */
    async runActivated(bytes) {
        await this.send(new Uint8Array(cmd.enablePrinter()));
        await this.send(new Uint8Array(cmd.WAKEUP));
        await this.send(new Uint8Array(bytes));
        await this.send(new Uint8Array(cmd.STOP_PRINT_JOB));
    }
    // --- Internals
    /** Chunks a payload and paces it against available credits. */
    async send(bytes) {
        const chunkSize = this.transport.maxChunkSize;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
            await this.flow.acquire(bytes.length);
            await this.transport.write(chunk);
        }
    }
    handleNotification(bytes) {
        // Credit frames are consumed first: treating one as a reply makes
        // `01 01` read as "battery: 1%".
        const wasCredit = this.flow.consume(bytes);
        const response = decode(bytes);
        this.events.onResponse?.(response, bytes);
        if (wasCredit)
            return;
        let changed = false;
        if (response.battery !== undefined) {
            this.info.battery = response.battery;
            changed = true;
        }
        if (response.status !== undefined) {
            this.info.status = response.status;
            changed = true;
        }
        if (response.kind === 'text') {
            // "V1.06LY" is a firmware string; "A2Y" a model.
            if (/^V\d/.test(response.text)) {
                this.info.firmware = response.text;
            }
            else if (this.info.model === undefined && response.text.length <= 12) {
                this.info.model = response.text;
            }
            changed = true;
        }
        if (changed)
            this.events.onInfo?.(this.info);
    }
}
