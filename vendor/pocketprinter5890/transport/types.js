/**
 * Transport abstraction.
 *
 * The protocol is identical everywhere; only the way a byte channel is
 * obtained differs. Implement this interface to support a new platform.
 *
 * Note that flow control is **not** the transport's responsibility: it lives
 * in the protocol layer, so it is written once rather than per adapter.
 */
/** Service and characteristic UUIDs. Only FF00 responds on this hardware. */
export const SERVICE_UUID = 0xff00;
export const WRITE_UUID = 0xff02;
export const NOTIFY_TX_UUID = 0xff01;
export const NOTIFY_STATUS_UUID = 0xff03;
/** Full-form UUIDs, required by some APIs. */
export const SERVICE_UUID_FULL = '0000ff00-0000-1000-8000-00805f9b34fb';
export const WRITE_UUID_FULL = '0000ff02-0000-1000-8000-00805f9b34fb';
export const NOTIFY_TX_UUID_FULL = '0000ff01-0000-1000-8000-00805f9b34fb';
export const NOTIFY_STATUS_UUID_FULL = '0000ff03-0000-1000-8000-00805f9b34fb';
