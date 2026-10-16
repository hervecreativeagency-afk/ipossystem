import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, receiptText, whatsappUrl, smsUrl, contactsCsv } from '../src/receipt-share.js';

const money = (n, c = 'ZMW') => new Intl.NumberFormat('en-ZM', { style: 'currency', currency: c }).format(Number(n || 0));
const sale = {
  receipt_number: 'IP-261016-ABC', created_at: '2026-10-16T09:05:00Z', currency: 'ZMW',
  items: [{ product_name: 'Mazoe Orange 2L', quantity: 2, unit_price: 35 }, { product_name: 'Bread', quantity: 1, unit_price: 25.5 }],
  subtotal: 95.5, tax: 0, discount: 5, total: 90.5, amount_paid: 100, change: 9.5,
  payments: [{ method: 'Cash', amount: 100 }],
};
const company = { name: 'Kabwe Mini Mart', phone: '0977 000 111', tpin: '1002003004', receipt_footer: 'Thank you, come again!', receipt_return_policy: 'Returns within 7 days with receipt.' };

test('Zambian numbers in every common format become one international number', () => {
  for (const n of ['0977123456', '0977 123 456', '977123456', '+260977123456', '+260 97 712 3456', '00260977123456', '260977123456'])
    assert.equal(normalizePhone(n), '260977123456', n);
  assert.equal(normalizePhone('+27 82 123 4567'), '27821234567');
  for (const bad of ['', '12345', '0977', 'abc', '+1234567890123456']) assert.equal(normalizePhone(bad), null, bad);
});

test('WhatsApp receipt has the store, items, totals and footer, with bold', () => {
  const t = receiptText(sale, { channel: 'whatsapp', company, money });
  for (const part of ['*Kabwe Mini Mart*', 'Receipt: IP-261016-ABC', '16 Oct 2026', '2 x Mazoe Orange 2L', 'Discount: -', '*Total: ', 'Cash: ', 'Change: ', 'TPIN: 1002003004', 'Returns within 7 days', 'Thank you, come again!'])
    assert.ok(t.includes(part), part + '\n' + t);
  assert.ok(t.includes('11:05'), 'shows Lusaka time');
  assert.ok(!t.includes('Tax:'), 'no tax line when tax is zero');
});

test('SMS receipt has no WhatsApp formatting and trims very long baskets', () => {
  const many = { ...sale, items: Array.from({ length: 20 }, (_, i) => ({ product_name: 'Item ' + i, quantity: 1, unit_price: 1 })) };
  const t = receiptText(many, { channel: 'sms', company, money });
  assert.ok(!t.includes('*'));
  assert.ok(t.includes('…and 5 more items'));
});

test('credit sales show what is owed; offline sales are marked provisional', () => {
  const credit = { ...sale, payments: [{ method: 'Customer credit', amount: 90.5 }], change: 0 };
  const t = receiptText(credit, { company, money, balanceOwed: 250 });
  assert.ok(t.includes('On account: ') && t.includes('*Balance owed: '));
  assert.ok(receiptText({ ...sale, offline: true }, { company, money }).includes('Provisional'));
});

test('links open WhatsApp and the SMS app with the text', () => {
  assert.equal(whatsappUrl('260977123456', 'Hi & bye'), 'https://wa.me/260977123456?text=Hi%20%26%20bye');
  assert.equal(smsUrl('260977123456', 'Total: K 5'), 'sms:+260977123456?&body=Total%3A%20K%205');
});

test('offers export only includes customers who agreed, and is spreadsheet-safe', () => {
  const csv = contactsCsv([
    { name: 'Ann', phone: '0977123456', marketing_opt_in: true, active: true, marketing_opt_in_at: '2026-10-16T09:00:00Z', last_receipt_at: '2026-10-16T09:05:00Z' },
    { name: 'Bob', phone: '0966000000', marketing_opt_in: false, active: true },
    { name: '=HYPERLINK("x")', phone: '+260 955 000 111', marketing_opt_in: true, active: true },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], 'Ann,0977123456,260977123456,2026-10-16,2026-10-16');
  assert.ok(lines[2].startsWith(`"'=HYPERLINK(""x"")",+260 955 000 111,260955000111`), lines[2]);
  assert.ok(!csv.includes('Bob'));
});
