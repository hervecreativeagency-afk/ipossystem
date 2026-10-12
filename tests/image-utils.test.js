import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImage} from '../src/image-utils.js';
test('image picker accepts supported raster formats within bucket limits',()=>{assert.equal(validateImage({type:'image/png',size:1024}),'png');assert.equal(validateImage({type:'image/jpeg',size:5*1024*1024}),'jpg');assert.equal(validateImage({type:'image/webp',size:200}),'webp')});
test('image picker rejects unsupported, empty and oversized files',()=>{assert.throws(()=>validateImage({type:'image/svg+xml',size:100}));assert.throws(()=>validateImage({type:'image/png',size:0}));assert.throws(()=>validateImage({type:'image/png',size:5*1024*1024+1}));assert.throws(()=>validateImage(null))});
