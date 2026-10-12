import test from 'node:test';
import assert from 'node:assert/strict';
import {auditChanges,auditValue} from '../src/audit-utils.js';
test('audit shows changed business values only',()=>{assert.deepEqual(auditChanges({id:'a',selling_price:50,name:'Milk'},{id:'b',selling_price:60,name:'Milk'}),[{key:'selling_price',label:'Selling price',before:50,after:60}]);});
test('audit formats money, permissions, added and nested values',()=>{assert.match(auditValue('selling_price',60),/60\.00/);assert.equal(auditValue('active',false),'No');assert.equal(auditValue('name',undefined),'—');assert.match(auditValue('items',[{name:'Milk',quantity:2}]),/Name: Milk/);assert.equal(auditChanges(null,{name:'Milk'}).length,1);});
