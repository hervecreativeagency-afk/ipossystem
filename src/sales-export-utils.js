import {cashbookPeriod,dateBounds} from './operation-utils.js';
export function exportRange(period,day,from,to){const range=period==='custom'?{from,to}:cashbookPeriod(period,day);dateBounds(range.from,range.to);return range;}
export function salesSummary(sales,payments,refunds){const groups={};const group=c=>groups[c] ||= {currency:c,transactions:0,subtotal:0,tax:0,discount:0,sales:0,refunds:0,refundTax:0,methods:{}};const ids=new Map();const round=n=>Math.round(n*100)/100;
 for(const s of sales){if(s.status!=='completed')continue;ids.set(s.id,s);const g=group(s.currency);g.transactions++;for(const k of ['subtotal','tax','discount'])g[k]+=Number(s[k]);g.sales+=Number(s.total);}
 const cashAdjusted=new Set();for(const p of payments){const s=ids.get(p.sale_id);if(!s)continue;let amount=Number(p.amount);if(p.method==='Cash'&&!cashAdjusted.has(s.id)){amount-=Number(s.change);cashAdjusted.add(s.id);}const g=group(s.currency);g.methods[p.method]=(g.methods[p.method]||0)+amount;}
 for(const r of refunds){const g=group(r.currency);g.refunds+=Number(r.total);g.refundTax+=Number(r.tax);}
 return Object.values(groups).map(g=>({...g,subtotal:round(g.subtotal),tax:round(g.tax),discount:round(g.discount),sales:round(g.sales),refunds:round(g.refunds),net:round(g.sales-g.refunds),methods:Object.fromEntries(Object.entries(g.methods).map(([k,v])=>[k,round(v)]))}));}
export function saleExportStatus(s){return s.refunded_total>0?(Number(s.refunded_total)>=Number(s.total)?'Refunded':'Partly refunded'):s.status;}
