# Diamonds, ads and payments: setup

Everything in the game already works in **test mode**: test ads (a 5 second fake ad) and test
purchases (no money moves), both clearly labelled in the shop. To earn real money, two accounts
need to be set up. Nothing secret ever goes in the game's code. Secret keys live only in Supabase.

## What's in the game

| Thing | Where | What it does |
|---|---|---|
| 💎 Diamonds | Menu, base screen | Second currency, next to 🧠 brains |
| Free 💎 | Missions 4-12 each, +5 per level, +3 per badge, ads +5 (5 a day) | About 20-45 a day without paying |
| 📺 2x brains ad | Game-over screen | Watch an ad, double the brains from that run (once) |
| 📺 Revive ad | Death screen (solo, not Hardcore) | One extra life per run: ad, revive token, or 25 💎 |
| 💎 Shop | Menu → 💎 Shop | Prism Laser (exclusive gun), 4 skins, bigger stash, elite crate, brains, revive tokens, double XP, mission swap |
| Diamond packs | 💎 Shop | 100 / 550 / 1,200 / 2,600 for $0.99 / $4.99 / $9.99 / $19.99 |

Code map: `src/diamonds.ts` (prices, rewards), `src/monetize/config.ts` (the on/off switches),
`src/monetize/ads.ts`, `src/monetize/pay.ts`, `supabase/diamonds.sql`, `supabase/functions/`.

## Part 1: real payments (Stripe + Supabase), about 30 minutes

1. **Make a Stripe account.** Go to https://dashboard.stripe.com/register, sign up, confirm your email.
   Stay in **Test mode** (the toggle at the top right) for now.
2. **Copy your test secret key.** Stripe: **Developers** (bottom left) → **API keys** → next to
   **Secret key** click **Reveal** → copy it (starts with `sk_test_`). Do not paste it anywhere except step 4.
3. **Create the purchases table.** Supabase (https://supabase.com/dashboard, open your project) →
   **SQL Editor** (left bar) → **New query** → paste all of `supabase/diamonds.sql` → **Run**. It should say "Success".
4. **Store the secrets.** Supabase → **Edge Functions** (left bar) → **Secrets** → add:
   - `STRIPE_SECRET_KEY` = the `sk_test_...` key
   - `ALLOWED_ORIGINS` = `https://botenclips-sudo.github.io`
5. **Deploy the checkout function.** Supabase → **Edge Functions** → **Deploy a new function** →
   **Via Editor** → name it exactly `create-checkout` → delete the sample code, paste all of
   `supabase/functions/create-checkout/index.ts` → **Deploy function**. Then open the function →
   **Details** (or **Settings**) → turn **off** "Verify JWT" / "Enforce JWT verification" → **Save**.
6. **Deploy the webhook function.** Same as step 5 but named `stripe-webhook`, pasting
   `supabase/functions/stripe-webhook/index.ts`. Turn **off** Verify JWT here too.
7. **Tell Stripe about the webhook.** Stripe → **Developers** → **Webhooks** → **Add endpoint**
   (may be called **Add destination**) → Endpoint URL:
   `https://xmxxxetnjyyvkmvakzji.supabase.co/functions/v1/stripe-webhook` → **Select events** →
   tick `checkout.session.completed` and `checkout.session.async_payment_succeeded` → **Add endpoint**.
   On the endpoint page click **Reveal** under **Signing secret**, copy it (starts with `whsec_`).
8. **Store the webhook secret.** Supabase → **Edge Functions** → **Secrets** → add
   `STRIPE_WEBHOOK_SECRET` = the `whsec_...` value.
9. **Tell Claude "payments are set up".** Claude flips `PAYMENTS_LIVE = true` in
   `src/monetize/config.ts`. Then test a pack on your phone with card `4242 4242 4242 4242`,
   any future date, any CVC. The diamonds should appear a few seconds after you come back.
10. **Go live.** Stripe → finish **Activate payments** (business details, ID, bank account).
    Switch the toggle to **Live mode**, repeat steps 2, 4 (replace `STRIPE_SECRET_KEY` with the
    `sk_live_` key), 7 and 8 in live mode.

Before going live you also need a short **Terms and refund policy** page (Stripe asks for one, and
it should say diamonds have no cash value and purchases are final unless the law says otherwise).
Claude can add one to the game.

How it stays safe: the browser only asks for a checkout and later asks "anything paid for me?".
Prices and diamond amounts are on the server. Only Stripe's signed webhook can record a purchase,
each Stripe session can only be credited once, and each purchase can only be claimed once.

## Part 2: real rewarded ads

**Honest warning:** Google's rewarded web ads (**H5 Games Ads**, inside AdSense) are invite-only
and AdSense usually rejects sites on `github.io`. The realistic paths, best first:

- **A. Custom domain + AdSense H5 Games Ads.** Buy a domain (about $10 a year, e.g. at
  Cloudflare or Namecheap), point it at GitHub Pages (repo **Settings** → **Pages** →
  **Custom domain**), then:
  1. https://adsense.google.com → **Get started** → sign in → enter your domain → submit.
  2. AdSense gives you a publisher id like `ca-pub-1234567890123456`. Send it to Claude: it goes in
     `ADSENSE_CLIENT` in `src/monetize/config.ts`, and Claude adds the `ads.txt` file AdSense asks for.
  3. Apply for H5 Games Ads: https://support.google.com/adsense/answer/9959170 → the interest form.
  4. Until approved, ads run with `ADS_TEST_MODE = true` (Google test ads). After approval,
     tell Claude and it flips that to false.
- **B. Publish on a game portal.** CrazyGames, Poki or GameDistribution host HTML5 games and pay
  you a share of their rewarded ads. No AdSense approval needed. Each has its own SDK; the game's
  ads go through one small `AdProvider` class, so adding one is a short job for Claude.

## Balance notes

- Diamonds buy looks, time and convenience. The only power item is the **Prism Laser**, a sidegrade
  priced at 250 💎, which a free player earns in about a week or two of missions and ads.
- The extra revive (ad / token / 💎) is once per run and off in Hardcore and co-op, so leaderboards
  stay mostly fair. Everyone can get it for free by watching an ad.
- Free diamond ads are capped at 5 a day so they don't feel like a chore.
