import test from 'node:test';
import assert from 'node:assert/strict';
import {totals,validateCart,paymentRows} from '../src/totals.js';
const product={id:'a',name:'Milk',selling_price:12.5,tax_rate:16,stock_quantity:3,quantity:2};
test('checkout totals include quantity, proportional discount and tax',()=>assert.deepEqual(totals([product],5),{subtotal:25,discount:5,tax:3.2,total:23.2}));
test('stock limits and empty cart',()=>{assert.throws(()=>validateCart([]));assert.throws(()=>validateCart([{...product,quantity:4}]));assert.throws(()=>validateCart([{...product,quantity:1.5}]));assert.doesNotThrow(()=>validateCart([product]));});
test('reject invalid discounts',()=>{assert.throws(()=>totals([product],26));assert.throws(()=>totals([product],-1));assert.throws(()=>totals([product],NaN));});
test('payment covers total and cash funds change',()=>{assert.throws(()=>paymentRows('Cash',20,{},23.2));assert.throws(()=>paymentRows('Bank/Card',30,{},23.2));assert.equal(paymentRows('Cash',30,{},23.2)[0].amount,30);assert.equal(paymentRows('Mixed payment',0,{'Cash':10,'MTN Money':20},23.2).length,2);assert.throws(()=>paymentRows('Mixed payment',0,{'MTN Money':30},23.2));});
test('round at cent precision',()=>assert.equal(totals([{...product,selling_price:.1,quantity:3,tax_rate:0}]).total,.3));
