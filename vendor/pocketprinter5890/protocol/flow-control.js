/**
 * Credit-based flow control.
 *
 * The printer emits `01 nn` frames announcing it can accept `nn` more
 * packets. These are **not** acknowledgements and **not** status codes.
 *
 * This logic deliberately lives in the protocol layer rather than in the
 * transport adapters: it is a rule of the protocol, and duplicating it across
 * adapters guarantees one copy will be wrong. Ignoring it altogether divides
 * throughput by roughly twenty.
 *
 * See `docs/PROTOCOL_SPEC.md` section 2.
 */
/** Payloads below this size are sent without waiting for credit. */
const SMALL_COMMAND_BYTES = 64;
export class CreditFlowController {
    credits = 0;
    waiters = [];
    /** Whether credit gating is applied. Disable only to compare behaviour. */
    enabled = true;
    /**
     * Feeds an incoming notification to the controller.
     *
     * @returns true if the frame was a credit frame and should not be treated
     *          as a command reply. A caller that ignores this will read
     *          `01 01` as "battery: 1%".
     */
    consume(bytes) {
        if (bytes.length !== 2 || bytes[0] !== 0x01)
            return false;
        this.credits += bytes[1];
        this.release();
        return true;
    }
    /** Waits until at least one credit is available. */
    async acquire(payloadSize, timeoutMs = 30_000) {
        // Short configuration commands always go through; only bulk raster data
        // needs pacing.
        if (!this.enabled || payloadSize < SMALL_COMMAND_BYTES || this.credits > 0) {
            if (this.credits > 0)
                this.credits -= 1;
            return;
        }
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter((w) => w !== waiter);
                // The printer went quiet: better to proceed than to hang forever.
                resolve();
            }, timeoutMs);
            const waiter = () => {
                clearTimeout(timer);
                resolve();
            };
            this.waiters.push(waiter);
        });
        if (this.credits > 0)
            this.credits -= 1;
    }
    /** Resets on connect: stale credits from a previous session are invalid. */
    reset() {
        this.credits = 0;
        this.release();
    }
    /** Current credit count, for diagnostics. */
    get available() {
        return this.credits;
    }
    release() {
        while (this.credits > 0 && this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            waiter?.();
        }
    }
}
