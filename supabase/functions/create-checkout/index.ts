// Supabase Edge Function: starts a Stripe Checkout for a diamond pack.
// The price and diamond amount come from PACKS below, never from the browser.
// Secrets (set in Supabase -> Edge Functions -> Secrets): STRIPE_SECRET_KEY, ALLOWED_ORIGINS.
// Deploy with "Verify JWT" turned OFF (the game sends a publishable key, not a user token).
import Stripe from 'npm:stripe@17.7.0';

const PACKS: Record<string, { diamonds: number; cents: number; name: string }> = {
  handful: { diamonds: 100, cents: 99, name: 'Handful of Diamonds (100)' },
  pouch: { diamonds: 550, cents: 499, name: 'Pouch of Diamonds (550)' },
  chest: { diamonds: 1200, cents: 999, name: 'Chest of Diamonds (1,200)' },
  vault: { diamonds: 2600, cents: 1999, name: 'Vault of Diamonds (2,600)' },
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { httpClient: Stripe.createFetchHttpClient() });
// Comma separated, e.g. "https://botenclips-sudo.github.io"
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://botenclips-sudo.github.io').split(',').map((s) => s.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'apikey, content-type, authorization, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });
  try {
    const { pack, buyer, back } = await req.json();
    const p = PACKS[pack];
    if (!p) return new Response(JSON.stringify({ error: 'Unknown pack' }), { status: 400, headers });
    if (typeof buyer !== 'string' || !UUID.test(buyer)) return new Response(JSON.stringify({ error: 'Bad buyer id' }), { status: 400, headers });
    // Only send players back to the real game, never to a page someone else picked.
    let url: URL;
    try {
      url = new URL(String(back));
    } catch {
      return new Response(JSON.stringify({ error: 'Bad return address' }), { status: 400, headers });
    }
    if (!ALLOWED.includes(url.origin)) return new Response(JSON.stringify({ error: 'Return address not allowed' }), { status: 400, headers });
    const base = url.origin + url.pathname;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: p.cents, product_data: { name: p.name } } }],
      client_reference_id: buyer,
      metadata: { buyer, pack, diamonds: String(p.diamonds) },
      success_url: `${base}?paid=1`,
      cancel_url: `${base}?canceled=1`,
    });
    return new Response(JSON.stringify({ url: session.url }), { headers });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'Store is unavailable right now' }), { status: 500, headers });
  }
});
