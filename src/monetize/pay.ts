// Real-money diamond packs. The client never decides how many diamonds a payment is worth:
// prices and amounts live on the server (supabase/functions/create-checkout), Stripe's webhook
// records each paid order, and the game only claims orders the server has already recorded.

import { FORCE_MOCK_PAY, PAYMENTS_LIVE } from './config';
import { SUPABASE_KEY, SUPABASE_URL } from '../leaderboard';

export interface DiamondPack {
  id: string;
  diamonds: number;
  bonus: string; // e.g. '+10%'
  price: string; // display only; the server owns the real price
  tag?: string;
}

/** Display copy of the packs. Keep in sync with PACKS in supabase/functions/create-checkout. */
export const PACKS: DiamondPack[] = [
  { id: 'handful', diamonds: 100, bonus: '', price: '$0.99' },
  { id: 'pouch', diamonds: 550, bonus: '+10%', price: '$4.99' },
  { id: 'chest', diamonds: 1200, bonus: '+20%', price: '$9.99', tag: 'POPULAR' },
  { id: 'vault', diamonds: 2600, bonus: '+30%', price: '$19.99', tag: 'BEST VALUE' },
];

export type BuyResult = { ok: true; diamonds: number } | { ok: false; redirecting?: boolean; error?: string };

export interface PaymentProvider {
  readonly test: boolean;
  /** Starts a purchase. Real payments leave the page for Stripe and come back with ?paid=1. */
  buy(pack: DiamondPack, buyer: string): Promise<BuyResult>;
  /** Diamonds paid for but not yet added to this save. Safe to call any time. */
  claim(buyer: string): Promise<number>;
}

/** Test purchases: a confirm sheet, then the diamonds. No money moves. */
export class MockPay implements PaymentProvider {
  readonly test = true;

  buy(pack: DiamondPack): Promise<BuyResult> {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay ad-mock';
      wrap.innerHTML = `<div class="panel"><p class="tiny">TEST PURCHASE · no real money, payments aren't connected yet</p><h2>💎 <span></span> diamonds</h2><p class="tag">Price when live: <b></b></p><button class="big">BUY (TEST)</button><button class="ghost">Cancel</button></div>`;
      wrap.querySelector('h2 span')!.textContent = pack.diamonds.toLocaleString();
      wrap.querySelector('b')!.textContent = pack.price;
      const done = (r: BuyResult) => {
        wrap.remove();
        resolve(r);
      };
      wrap.querySelector('.big')!.addEventListener('click', () => done({ ok: true, diamonds: pack.diamonds }));
      wrap.querySelector('.ghost')!.addEventListener('click', () => done({ ok: false }));
      document.body.appendChild(wrap);
    });
  }

  async claim() {
    return 0;
  }
}

/** Stripe Checkout through two Supabase Edge Functions (secret keys stay on Supabase). */
export class StripePay implements PaymentProvider {
  readonly test = false;
  private headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

  async buy(pack: DiamondPack, buyer: string): Promise<BuyResult> {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ pack: pack.id, buyer, back: location.origin + location.pathname }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) return { ok: false, error: j.error ?? `Store error (${res.status})` };
      location.href = j.url;
      return { ok: false, redirecting: true };
    } catch {
      return { ok: false, error: "Couldn't reach the store. Check your connection." };
    }
  }

  async claim(buyer: string) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_diamonds`, { method: 'POST', headers: this.headers, body: JSON.stringify({ p_buyer: buyer }) });
      if (!res.ok) return 0;
      const n = Number(await res.json());
      return isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }
}

export const pay: PaymentProvider = PAYMENTS_LIVE && !FORCE_MOCK_PAY ? new StripePay() : new MockPay();
