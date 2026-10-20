/**
 * Verification script for server-authoritative pricing (issue #16).
 * Run: npx tsx test/verify-pricing.ts
 *
 * Proves against the live API:
 *   1. Negative per-line discount is rejected (400)
 *   2. A tampered low unitPrice is rejected with 409 PRICE_CHANGED
 *      (server returns the real batch price for the POS to refresh)
 *   3. On the FEFO path (no batchId) a client-sent unitPrice is IGNORED —
 *      batch selling prices always win
 *   4. An oversized discount can never produce a free sale:
 *      per-line discount is capped at the line gross, and a total that
 *      reaches $0.00 is rejected with 400 TOTAL_TOO_LOW
 *      (schema invariant: payments.amount CHECK (amount > 0))
 *   5. A large but legitimate discount is honored with a positive total
 *   6. A normal checkout with correct prices still succeeds (regression)
 */

const BASE = process.env.API_BASE || 'http://localhost:5000/api/v1';
let failures = 0;

function check(name: string, pass: boolean, detail = '') {
  const mark = pass ? '\x1b[32m✅ PASS\x1b[0m' : '\x1b[31m❌ FAIL\x1b[0m';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': 't-retail-001' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json, text };
}

/** Resolve a fresh FEFO allocation to learn a real productId/batchId/price. */
async function resolveFefo() {
  const prods = await api('GET', '/products');
  const list: any[] = Array.isArray(prods.body) ? prods.body : prods.body?.products || [];
  if (list.length === 0) throw new Error('No products available for pricing test');

  for (const p of list) {
    const fefo = await api('POST', '/fefo/resolve', { productId: p.id, requestedQuantity: 1 });
    const alloc = fefo.body?.allocations?.[0];
    if (alloc && Number(alloc.unitPrice) >= 1) {
      return { productId: p.id, productName: p.name, batchId: alloc.batchId, unitPrice: Number(alloc.unitPrice) };
    }
  }
  throw new Error('No in-stock product priced >= $1 found');
}

async function main() {
  console.log('─'.repeat(64));

  // 1. Negative discount rejected
  const a = await resolveFefo();
  const neg = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: a.productId, batchId: a.batchId, quantity: 1, discountAmount: -5 }],
    payment: { method: 'CASH', tenderedAmount: 10 }
  });
  check('Negative per-line discount rejected with 400', neg.status === 400, `status=${neg.status}`);

  // 2. Tampered low unitPrice -> 409 PRICE_CHANGED with the real server price
  const b = await resolveFefo();
  const tampered = Math.max(0, b.unitPrice - 1);
  const low = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: b.productId, batchId: b.batchId, quantity: 1, unitPrice: tampered }],
    payment: { method: 'CASH', tenderedAmount: 100 }
  });
  const returnedPrice = low.body?.items?.[0]?.unitPrice;
  check('Tampered low unitPrice rejected with 409 PRICE_CHANGED',
    low.status === 409 && low.body?.code === 'PRICE_CHANGED',
    `status=${low.status} code=${low.body?.code}`);
  check('409 body carries the real server price for cart refresh',
    typeof returnedPrice === 'number' && Math.abs(returnedPrice - b.unitPrice) < 0.005,
    `returned=${returnedPrice} server=${b.unitPrice}`);

  // 3. FEFO path ignores any client-sent unitPrice
  const c = await resolveFefo();
  const fefo = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: c.productId, quantity: 1, unitPrice: 0.01 }],
    payment: { method: 'CASH', tenderedAmount: 100 }
  });
  if (fefo.status === 200) {
    const charged = Number(fefo.body?.items?.[0]?.unitPrice);
    check('FEFO path uses server batch price (client 0.01 ignored)',
      Math.abs(charged - c.unitPrice) < 0.005, `charged=${charged} server=${c.unitPrice}`);
  } else {
    check('FEFO path checkout accepted (200)', false, `status=${fefo.status} ${fefo.text?.slice(0, 160)}`);
  }

  // 4a. Oversized discount on the explicit-batch path -> no free sale
  const d = await resolveFefo();
  const huge = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: d.productId, batchId: d.batchId, quantity: 1, unitPrice: d.unitPrice, discountAmount: 999999 }],
    payment: { method: 'CASH', tenderedAmount: 100000 }
  });
  check('Oversized discount (explicit batch) rejected with 400 TOTAL_TOO_LOW',
    huge.status === 400 && huge.body?.code === 'TOTAL_TOO_LOW',
    `status=${huge.status} code=${huge.body?.code}`);

  // 4b. Oversized discount on the FEFO path -> same rejection
  const e = await resolveFefo();
  const hugeFefo = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: e.productId, quantity: 1, unitPrice: 999999, discountAmount: 999999 }],
    payment: { method: 'CASH', tenderedAmount: 100000 }
  });
  check('Oversized discount (FEFO path) rejected with 400 TOTAL_TOO_LOW',
    hugeFefo.status === 400 && hugeFefo.body?.code === 'TOTAL_TOO_LOW',
    `status=${hugeFefo.status} code=${hugeFefo.body?.code}`);

  // 5. Large but legitimate discount honored, total stays positive
  const f = await resolveFefo();
  const legitDiscount = Number((f.unitPrice - 0.60).toFixed(2));
  const legit = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: f.productId, batchId: f.batchId, quantity: 1, unitPrice: f.unitPrice, discountAmount: legitDiscount }],
    payment: { method: 'CASH', tenderedAmount: 100 }
  });
  if (legit.status === 200) {
    const line = legit.body?.items?.[0];
    const grand = Number(legit.body?.grandTotal);
    check('Legitimate big discount is honored (not capped)',
      Math.abs(Number(line?.discountAmount) - legitDiscount) < 0.011,
      `discount=${line?.discountAmount} sent=${legitDiscount}`);
    check('Discounted invoice keeps a positive total',
      grand > 0, `grand=${grand}`);
  } else {
    check('Legitimate discounted checkout accepted (200)', false, `status=${legit.status} ${legit.text?.slice(0, 160)}`);
  }

  // 6. Normal correct-price checkout still succeeds (regression)
  const g = await resolveFefo();
  const ok = await api('POST', '/checkout/commit', {
    drawerId: '',
    items: [{ productId: g.productId, batchId: g.batchId, quantity: 1, unitPrice: g.unitPrice, discountAmount: 0 }],
    payment: { method: 'CASH', tenderedAmount: 100 }
  });
  check('Correct-price checkout returns 200', ok.status === 200,
    ok.status === 200 ? `invoice=${ok.body?.invoiceNumber}` : `status=${ok.status} ${ok.text?.slice(0, 160)}`);

  console.log('─'.repeat(64));
  if (failures > 0) {
    console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mALL PRICING VERIFICATIONS PASSED\x1b[0m');
  process.exit(0);
}

main().catch(err => {
  console.error('Pricing verification crashed:', err);
  process.exit(1);
});
