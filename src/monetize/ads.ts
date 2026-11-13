// Rewarded ads: the player always chooses to watch one, and gets something for it.
// The game only talks to AdProvider, so swapping networks means writing one new class.

import { ADS_TEST_MODE, ADSENSE_CLIENT, FORCE_MOCK_ADS } from './config';

export type AdPlacement = 'revive' | 'double' | 'diamonds';
export type AdResult = 'rewarded' | 'skipped' | 'unavailable';

export interface AdProvider {
  /** Shown in the UI so test ads are never mistaken for real ones. */
  readonly test: boolean;
  showRewarded(placement: AdPlacement): Promise<AdResult>;
}

/** Test ads: a 5 second fake ad with a skip button. Lets the whole flow be tried without an ad account. */
export class MockAds implements AdProvider {
  readonly test = true;
  constructor(private seconds = 5) {}

  showRewarded(placement: AdPlacement): Promise<AdResult> {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'overlay ad-mock';
      wrap.innerHTML = `<div class="panel"><p class="tiny">TEST AD · no ad network connected yet</p><h2>📺 Your ad here</h2><p class="tag">Reward: <b></b></p><div class="ad-bar"><div></div></div><button class="big" disabled></button><button class="ghost">Skip (no reward)</button></div>`;
      const label = { revive: 'get back up', double: 'double brains', diamonds: 'free diamonds' }[placement];
      wrap.querySelector('b')!.textContent = label;
      const claim = wrap.querySelector<HTMLButtonElement>('.big')!;
      const bar = wrap.querySelector<HTMLElement>('.ad-bar div')!;
      let left = this.seconds;
      const tick = () => {
        claim.textContent = left > 0 ? `Reward in ${left}…` : 'CLAIM REWARD';
        claim.disabled = left > 0;
        bar.style.width = `${Math.round((1 - left / this.seconds) * 100)}%`;
      };
      tick();
      const iv = setInterval(() => {
        left = Math.max(0, left - 1);
        tick();
        if (left === 0) clearInterval(iv);
      }, 1000);
      const done = (r: AdResult) => {
        clearInterval(iv);
        wrap.remove();
        resolve(r);
      };
      claim.addEventListener('click', () => done('rewarded'));
      wrap.querySelector('.ghost')!.addEventListener('click', () => done('skipped'));
      document.body.appendChild(wrap);
    });
  }
}

interface AdBreakDone {
  breakStatus: string;
}
interface AdBreakOpts {
  type: 'reward';
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  beforeReward: (showAdFn: () => void) => void;
  adDismissed: () => void;
  adViewed: () => void;
  adBreakDone: (info: AdBreakDone) => void;
}
type AdsWindow = Window & { adsbygoogle?: unknown[]; adBreak?: (o: AdBreakOpts) => void; adConfig?: (o: Record<string, string>) => void };

/** Google H5 Games Ads (the Ad Placement API in AdSense). Needs an approved AdSense account. */
export class H5GamesAds implements AdProvider {
  readonly test = ADS_TEST_MODE;
  /** Called around the ad so the game can mute itself while it plays. */
  onAdStart = () => {};
  onAdEnd = () => {};

  constructor(client: string) {
    const w = window as AdsWindow;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    s.crossOrigin = 'anonymous';
    s.dataset.adClient = client;
    if (ADS_TEST_MODE) s.dataset.adbreakTest = 'on';
    document.head.appendChild(s);
    w.adsbygoogle = w.adsbygoogle || [];
    w.adBreak = w.adConfig = (o: unknown) => w.adsbygoogle!.push(o);
    w.adConfig!({ preloadAdBreaks: 'on', sound: 'on' });
  }

  showRewarded(placement: AdPlacement): Promise<AdResult> {
    const w = window as AdsWindow;
    return new Promise((resolve) => {
      let result: AdResult = 'unavailable';
      // If the ad script was blocked (ad blocker, offline) nothing ever calls back.
      const timeout = setTimeout(() => finish(), 8000);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      w.adBreak!({
        type: 'reward',
        name: placement,
        beforeAd: () => {
          clearTimeout(timeout);
          this.onAdStart();
        },
        afterAd: () => this.onAdEnd(),
        // An ad is ready. The player already tapped "watch ad", so show it straight away.
        beforeReward: (showAdFn) => {
          clearTimeout(timeout);
          showAdFn();
        },
        adViewed: () => (result = 'rewarded'),
        adDismissed: () => (result = 'skipped'),
        adBreakDone: () => finish(),
      });
    });
  }
}

export const ads: AdProvider = ADSENSE_CLIENT && !FORCE_MOCK_ADS ? new H5GamesAds(ADSENSE_CLIENT) : new MockAds();
