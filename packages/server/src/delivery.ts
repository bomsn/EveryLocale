import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeliveryStore } from '@everylocale/store';

export type DeliveryConfig = { url: string; secret: string };
export function validateDelivery(config: DeliveryConfig) {
  const url = new URL(config.url);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    config.secret.length < 32 ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Webhook requires HTTPS, an independent secret, and no URL credentials');
}
export function verifyDelivery(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
) {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
/** A receiver can act twice after a network interruption, so its event ID must be deduplicated. */
export class DeliveryWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private active?: Promise<void>;
  private abort = new AbortController();
  constructor(
    private store: DeliveryStore,
    private config: DeliveryConfig,
  ) {
    validateDelivery(config);
  }
  async deliverOnce() {
    const claim = this.store.claimDelivery();
    if (!claim) return false;
    const body = JSON.stringify({ schemaVersion: 1, ...claim.event });
    const timestamp = String(Date.now());
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]),
        headers: {
          'content-type': 'application/json',
          'x-everylocale-event-id': claim.event.id,
          'x-everylocale-timestamp': timestamp,
          'x-everylocale-signature': createHmac('sha256', this.config.secret)
            .update(`${timestamp}.${body}`)
            .digest('hex'),
        },
        body,
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
      this.store.settleDelivery(claim.event.id, claim.leaseToken);
    } catch (error) {
      this.store.settleDelivery(
        claim.event.id,
        claim.leaseToken,
        error instanceof Error && /^Webhook returned HTTP \d+$/.test(error.message)
          ? error.message
          : 'Webhook delivery interrupted or unavailable',
      );
    }
    return true;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      this.active = this.deliverOnce()
        .catch(() => undefined)
        .then(() => {
          if (!this.stopped) {
            this.timer = setTimeout(tick, 500);
            this.timer.unref();
          }
        });
    };
    tick();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort.abort();
    await this.active;
  }
}
