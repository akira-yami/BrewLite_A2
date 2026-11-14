#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose --env-file .env.example -f compose.yaml -p brewlite-a2-ci)
api="http://localhost:${API_PORT:-3001}"
web="http://localhost:${WEB_PORT:-3000}"

start_time=$SECONDS
"${compose[@]}" up --no-build --wait --wait-timeout 180
echo "Compose healthy after $((SECONDS - start_time))s with images built"
"${compose[@]}" run --rm --no-deps seed
node apps/api/scripts/smoke.mjs "$api"
curl --fail --silent --show-error --location --max-time 15 "$web/menu" -o /dev/null

# Create and pay once via normal HTTP on this disposable Compose stack.
order_id="$(node --input-type=module - "$api" <<'JS'
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.argv[2] + '/api/v1';
async function request(path, data, headers = {}) {
  const response = await fetch(base + path, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: data && JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(response.ok, path + ' returned HTTP ' + response.status);
  return (await response.json()).data;
}

const user = await request('/auth/register', {
  username: 'compose_' + randomUUID().slice(0, 8),
  password: randomUUID(),
});
const products = await request('/products');
const variant = products.flatMap(product => product.variants).find(item => item.available);
assert.ok(variant, 'Catalog must have an available variant');
const headers = { Authorization: 'Bearer ' + user.accessToken };
const order = await request('/orders', { items: [{ productVariantId: variant.id, quantity: 1 }] }, headers);
assert.equal(order.status, 'PENDING');
const payment = await request('/payments', { orderId: order.id, method: 'E_WALLET' }, {
  ...headers, 'Idempotency-Key': randomUUID(),
});
assert.equal(payment.status, 'SUCCEEDED');
assert.equal((await request('/orders/' + order.id, undefined, headers)).status, 'PAID');
console.log(order.id);
JS
)"
[[ "$order_id" =~ ^[0-9a-f-]{36}$ ]]
echo "Checkout order $order_id reached PAID"

psql() {
  "${compose[@]}" exec -T postgres psql -X -U brewlite -d brewlite -Atc "$1"
}

seed_query="SELECT (SELECT count(*) FROM products), (SELECT count(*) FROM product_variants), (SELECT count(*) FROM recipe_items), (SELECT count(*) FROM users)"
seed_count="$(psql "$seed_query")"
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" run --rm --no-deps seed
test "$seed_count" = "$(psql "$seed_query")"
echo "Migration and seed replay preserved seeded row counts ($seed_count)"

"${compose[@]}" down
"${compose[@]}" up --no-build --wait --wait-timeout 180
test "$(psql "SELECT status FROM orders WHERE id='$order_id'")" = PAID
echo "Order $order_id remained PAID after restarting the stack with its volume"
