// Supabase Edge Function: Stripe calls this after a payment. It checks Stripe's signature, then
// records the purchase so the game can claim the diamonds. This is the only thing that can add
// diamonds bought with real money, and it never trusts anything the browser says.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided by Supabase automatically. Deploy with "Verify JWT" turned OFF (Stripe has no JWT).
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Must match create-checkout. Amounts are re-checked here so a tampered session can't over-credit.
const PACKS: Record<string, { diamonds: number; cents: number }> = {
  handful: { diamonds: 100, cents: 99 },
  pouch: { diamonds: 550, cents: 499 },
  chest: { diamonds: 1200, cents: 999 },
  vault: { diamonds: 2600, cents: 1999 },
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { httpClient: Stripe.createFetchHttpClient() });
const crypto = Stripe.createSubtleCryptoProvider();
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('No signature', { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '', undefined, crypto);
  } catch (e) {
    console.error('Bad signature', e);
    return new Response('Bad signature', { status: 400 });
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return new Response('ignored');
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.payment_status !== 'paid') return new Response('not paid yet');
  const pack = PACKS[s.metadata?.pack ?? ''];
  const buyer = s.metadata?.buyer ?? '';
  if (!pack || !buyer || s.amount_total !== pack.cents) {
    console.error('Session does not match a pack', s.id);
    return new Response('mismatch', { status: 200 }); // 200 so Stripe stops retrying; check the logs
  }
  // session_id is unique, so Stripe retrying the same event can never credit twice.
  const { error } = await db
    .from('diamond_purchases')
    .upsert({ session_id: s.id, buyer, pack: s.metadata!.pack, diamonds: pack.diamonds, amount_cents: s.amount_total, currency: s.currency ?? 'usd' }, { onConflict: 'session_id', ignoreDuplicates: true });
  if (error) {
    console.error(error);
    return new Response('db error', { status: 500 }); // Stripe will retry
  }
  return new Response('ok');
});
