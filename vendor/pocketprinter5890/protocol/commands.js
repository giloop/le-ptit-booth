/**
 * Proprietary command set, ported from the LuckPrinter SDK found in the
 * official `com.printer.lidloffice` application.
 *
 * Byte sequences are documented in `docs/PROTOCOL_SPEC.md`. Commands marked
 * UNVERIFIED were transcribed from the SDK but never executed on hardware:
 * the SDK covers 150+ printer models and nothing guarantees this one
 * implements them.
 */
/** Print density. */
export var Density;
(function (Density) {
    Density[Density["Light"] = 0] = "Light";
    Density[Density["Medium"] = 1] = "Medium";
    Density[Density["Dark"] = 2] = "Dark";
})(Density || (Density = {}));
/**
 * Enables the print motor.
 *
 * Without this the firmware acknowledges every command and executes nothing,
 * not even a paper feed.
 */
export const enablePrinter = (mode = 3) => [0x10, 0xff, 0xf1, mode];
/**
 * Wake-up.
 *
 * This is a **separate write**, not padding appended to `enablePrinter`.
 * Several public write-ups get this wrong; sending them concatenated fails.
 */
export const WAKEUP = new Array(12).fill(0x00);
/** Ends a print job and triggers the actual printing. */
export const STOP_PRINT_JOB = [0x10, 0xff, 0xf1, 0x45];
/** Positions the next label. Label mode only — wastes paper on a roll. */
export const POSITION = [0x1d, 0x0c];
/**
 * Declares a fixed label length. Label mode only.
 *
 * Sending this on continuous paper makes the printer feed to the end of the
 * declared length.
 */
export const setPaperType = (type = 1, length = 32) => [0x1f, 0x80, type, length];
/** Sets print density. */
export const setDensity = (density) => [0x10, 0xff, 0x10, 0x00, density];
// --- Read commands, replies arrive on FF01 ---
export const READ_MODEL = [0x10, 0xff, 0x20, 0xf0];
export const READ_FIRMWARE = [0x10, 0xff, 0x20, 0xf1];
export const READ_SERIAL = [0x10, 0xff, 0x20, 0xf2];
export const READ_BOOTLOADER = [0x10, 0xff, 0x20, 0xef];
export const READ_BATTERY = [0x10, 0xff, 0x50, 0xf1];
export const READ_STATUS = [0x10, 0xff, 0x40];
export const READ_DENSITY = [0x10, 0xff, 0x11];
export const READ_SPEED = [0x10, 0xff, 0x20, 0xa0];
export const READ_AUTO_SHUTDOWN = [0x10, 0xff, 0x13];
export const READ_TIME_FORMAT = [0x10, 0xff, 0xb0];
export const READ_SETTINGS = [0x10, 0xff, 0x70];
// --- Write commands. Everything below is UNVERIFIED on this firmware ---
/**
 * Auto power-off delay, in minutes.
 *
 * Two bytes, **big-endian**. Note that `setWidth` below uses the opposite
 * order: the SDK is not consistent about this.
 *
 * UNVERIFIED. Passing 0 to disable power-off is a common convention but has
 * not been confirmed; read back with `READ_AUTO_SHUTDOWN` to see what the
 * firmware actually stored.
 */
export const setAutoShutdown = (minutes) => [
    0x10, 0xff, 0x12,
    Math.floor(minutes / 256) & 0xff,
    minutes % 256,
];
/** Print width in dots. Two bytes, **little-endian**. UNVERIFIED. */
export const setWidth = (dots) => [
    0x10, 0xff, 0x15,
    dots % 256,
    Math.floor(dots / 256) & 0xff,
];
/** Print speed. UNVERIFIED. */
export const setSpeed = (level) => [0x10, 0xff, 0xc0, level];
/** Print head heating level. UNVERIFIED. */
export const setHeatingLevel = (level) => [0x1f, 0x70, 0x01, level];
/** Printer mode. UNVERIFIED. */
export const setPrinterMode = (mode) => [0x10, 0xff, 0x30, 0x27, mode];
/** Factory reset. UNVERIFIED and **destructive** if supported. */
export const FACTORY_RESET = [0x10, 0xff, 0x04];
/** Client platform declaration. UNVERIFIED. */
export const SET_PLATFORM = [0xfc, 0xff, 0x00, 0x02, 0x45, 0x02, 0x00, 0x46];
/**
 * Sets the internal clock. UNVERIFIED.
 *
 * The `10 FF 53 4A <format>` header precedes the date; sending the seven
 * date bytes alone does nothing.
 */
export function setClock(date, format = 0) {
    const year = date.getFullYear();
    return [
        0x10, 0xff, 0x53, 0x4a, format,
        Math.floor(year / 256) & 0xff,
        year % 256,
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
    ];
}
/** Cut marks. UNVERIFIED. */
export const MARK_FIRST = [0x1b, 0xbb, 0xcc];
export const MARK_LAST = [0x1b, 0xbb, 0xbb];
export const MARK_INTERMEDIATE = [0x1b, 0xbb, 0xaa];
/** Reverse feed, in dots. UNVERIFIED. */
export const reverseFeed = (dots) => [0x1f, 0x11, 0x11, dots];
/** Automatic positioning. UNVERIFIED. */
export const autoPosition = (value) => [0x1f, 0x11, value];
/**
 * Printer status bitfield, as returned by `READ_STATUS`.
 *
 * Not to be confused with `01 nn` flow-control credit frames, which are not
 * status at all.
 */
export class PrinterStatus {
    raw;
    constructor(raw) {
        this.raw = raw;
    }
    get isPrinting() { return (this.raw & 0x01) !== 0; }
    get isCoverOpen() { return (this.raw & 0x02) !== 0; }
    get isPaperEmpty() { return (this.raw & 0x04) !== 0; }
    get isBatteryLow() { return (this.raw & 0x08) !== 0; }
    get isCharging() { return (this.raw & 0x20) !== 0; }
    get isOverheating() { return (this.raw & 0x50) !== 0; }
    /** States that genuinely prevent printing. */
    get isBlocking() {
        return this.isCoverOpen || this.isPaperEmpty || this.isOverheating;
    }
    toString() {
        const parts = [];
        if (this.isPrinting)
            parts.push('printing');
        if (this.isCoverOpen)
            parts.push('cover open');
        if (this.isPaperEmpty)
            parts.push('no paper');
        if (this.isBatteryLow)
            parts.push('battery low');
        if (this.isCharging)
            parts.push('charging');
        if (this.isOverheating)
            parts.push('overheating');
        return parts.length ? parts.join(', ') : 'ready';
    }
}
