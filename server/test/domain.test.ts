import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { isOpenAt } from '../src/domain/hours.js';
import { canTransition, nextStatus } from '../src/domain/orderFlow.js';
import { couponDiscount, priceItem, PricingError, type Catalog } from '../src/domain/pricing.js';
import { SecretBox } from '../src/lib/crypto.js';
import { verifyMercadoPagoSignature } from '../src/payments/mercadopago.js';

const S = '00000000-0000-4000-8000-000000000001';
const F1 = '00000000-0000-4000-8000-000000000011';
const F2 = '00000000-0000-4000-8000-000000000012';
const C1 = '00000000-0000-4000-8000-000000000021';
const A1 = '00000000-0000-4000-8000-000000000031';

function catalog(rule: 'highest' | 'average'): Catalog {
  const s = (id: string, name: string) => ({ id, name, active: true, available: true });
  return {
    halfHalfPricing: rule,
    sizes: new Map([[S, { id: S, name: 'Grande', max_flavors: 2, active: true }]]),
    flavors: new Map([[F1, s(F1, 'Calabresa')], [F2, s(F2, 'Camarão')]]),
    flavorPrices: new Map([[`${F1}:${S}`, 5000], [`${F2}:${S}`, 8000]]),
    crusts: new Map([[C1, s(C1, 'Catupiry')]]),
    crustPrices: new Map([[`${C1}:${S}`, 1000]]),
    products: new Map(),
    addons: new Map([[A1, { ...s(A1, 'Bacon'), price_cents: 500, applies_to: 'pizza' as const }]]),
  };
}

test('meio a meio cobra o sabor mais caro', () => {
  const item = priceItem(catalog('highest'), { kind: 'pizza', size_id: S, flavor_ids: [F1, F2], crust_id: C1, addon_ids: [A1], quantity: 2 });
  assert.equal(item.unit_price_cents, 8000 + 1000 + 500);
  assert.equal(item.total_cents, 19000);
  assert.match(item.description, /1\/2 Calabresa, 1\/2 Camarão · Borda Catupiry · \+ Bacon/);
});

test('meio a meio pela média', () => {
  const item = priceItem(catalog('average'), { kind: 'pizza', size_id: S, flavor_ids: [F1, F2], quantity: 1 });
  assert.equal(item.unit_price_cents, 6500);
});

test('rejeita sabores acima do limite do tamanho e itens indisponíveis', () => {
  const c = catalog('highest');
  assert.throws(() => priceItem(c, { kind: 'pizza', size_id: S, flavor_ids: [F1, F2, A1], quantity: 1 }), PricingError);
  c.flavors.get(F2)!.available = false;
  assert.throws(() => priceItem(c, { kind: 'pizza', size_id: S, flavor_ids: [F2], quantity: 1 }), /não está disponível/);
});

test('cupons: percentual, fixo, frete grátis, limites', () => {
  const base = { code: 'X', min_order_cents: 0, max_uses: null, used_count: 0, starts_at: null, ends_at: null, active: true };
  assert.equal(couponDiscount({ ...base, type: 'percent', value: 10 }, 5000, 800), 500);
  assert.equal(couponDiscount({ ...base, type: 'fixed', value: 9000 }, 5000, 800), 5000);
  assert.equal(couponDiscount({ ...base, type: 'free_delivery', value: 0 }, 5000, 800), 800);
  assert.throws(() => couponDiscount({ ...base, type: 'percent', value: 10, max_uses: 1, used_count: 1 }, 5000, 0), /limite/);
  assert.throws(() => couponDiscount({ ...base, type: 'percent', value: 10, min_order_cents: 6000 }, 5000, 0), /a partir/);
  assert.throws(() => couponDiscount({ ...base, type: 'percent', value: 10, ends_at: '2000-01-01T00:00:00Z' }, 5000, 0), /expirou/);
});

test('horário de funcionamento atravessando a meia-noite', () => {
  const hours = [{ weekday: 5, opens: '18:00', closes: '02:00' }]; // sexta 18h → sábado 2h
  const tz = 'America/Sao_Paulo';
  assert.equal(isOpenAt(hours, tz, new Date('2026-10-23T23:00:00-03:00')), true); // sexta 23h
  assert.equal(isOpenAt(hours, tz, new Date('2026-10-24T01:30:00-03:00')), true); // sábado 1h30
  assert.equal(isOpenAt(hours, tz, new Date('2026-10-24T02:30:00-03:00')), false);
  assert.equal(isOpenAt(hours, tz, new Date('2026-10-23T17:59:00-03:00')), false);
});

test('fluxo de status do pedido', () => {
  assert.equal(nextStatus('ready', 'pickup'), 'completed');
  assert.equal(nextStatus('ready', 'delivery'), 'out_for_delivery');
  assert.equal(canTransition('pending', 'ready', 'delivery'), true);
  assert.equal(canTransition('ready', 'accepted', 'delivery'), false);
  assert.equal(canTransition('ready', 'out_for_delivery', 'pickup'), false);
  assert.equal(canTransition('completed', 'cancelled', 'pickup'), false);
  assert.equal(canTransition('awaiting_payment', 'accepted', 'pickup'), false);
});

test('criptografia de segredos (AES-256-GCM)', () => {
  const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
  const enc = box.encrypt('APP_USR-123');
  assert.notEqual(enc, 'APP_USR-123');
  assert.equal(box.decrypt(enc), 'APP_USR-123');
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A') + '=';
  assert.throws(() => box.decrypt(tampered));
});

test('assinatura do webhook do Mercado Pago', () => {
  const secret = 'segredo-webhook';
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = createHmac('sha256', secret).update(`id:123456;request-id:req-1;ts:${ts};`).digest('hex');
  const header = `ts=${ts},v1=${v1}`;
  assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: header, requestId: 'req-1', dataId: '123456' }), true);
  assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: header, requestId: 'req-2', dataId: '123456' }), false);
  assert.equal(verifyMercadoPagoSignature({ secret: 'outro', signatureHeader: header, requestId: 'req-1', dataId: '123456' }), false);
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const v1old = createHmac('sha256', secret).update(`id:123456;request-id:req-1;ts:${old};`).digest('hex');
  assert.equal(verifyMercadoPagoSignature({ secret, signatureHeader: `ts=${old},v1=${v1old}`, requestId: 'req-1', dataId: '123456' }), false);
});
