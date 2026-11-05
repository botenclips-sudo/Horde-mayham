// Switches for the real ad network and real payments. Until these are filled in, the game uses
// test ads and test purchases (clearly labelled, no real money) so everything can be tried out.
// Setup steps for both are in MONETIZATION.md at the repo root.

/** Your AdSense publisher id for H5 Games Ads, e.g. 'ca-pub-1234567890123456'. Empty = test ads. */
export const ADSENSE_CLIENT = '';
/** Keep true until Google approves the site: real ad slots, but Google serves test ads. */
export const ADS_TEST_MODE = true;

/** Flip to true once the Stripe + Supabase steps in MONETIZATION.md are done. False = test purchases. */
export const PAYMENTS_LIVE = false;

const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** ?mockads / ?mockpay force the test providers, even after the real ones are switched on. */
export const FORCE_MOCK_ADS = qs.has('mockads');
export const FORCE_MOCK_PAY = qs.has('mockpay');
