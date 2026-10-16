export const cents = n => Math.round(Number(n)*100);
export function totals(cart,discount=0){
 const subtotal=cart.reduce((s,i)=>s+cents(i.selling_price)*i.quantity,0);
 const d=cents(discount);
 if(!Number.isFinite(d)||d<0||d>subtotal)throw Error('Discount must be between zero and the subtotal.');
 const tax=cart.reduce((s,i)=>s+Math.round(cents(i.selling_price)*i.quantity*(subtotal ? (subtotal-d)/subtotal:1)*Number(i.tax_rate)/100),0);
 return {subtotal:subtotal/100,discount:d/100,tax:tax/100,total:(subtotal-d+tax)/100};
}
export function validateCart(cart){if(!cart.length)throw Error('Add at least one product.'); for(const i of cart){if(!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>i.stock_quantity)throw Error(`Insufficient stock for ${i.name}.`);} }
// Largest value the database can store in a money column (numeric 12,2).
export const MAX_AMOUNT=9999999999.99;
export const paymentMethods=['Cash','Airtel Money','MTN Money','Bank/Card'];
// Goods taken now, paid later. Recorded as a payment so totals balance, but it is not money received.
export const CREDIT='Customer credit';
export function paymentRows(method,paid,mixed,total,{credit=false}={}){
 const allowed=credit?[...paymentMethods,CREDIT]:paymentMethods;
 if(![...allowed,'Mixed payment'].includes(method))throw Error('Select a valid payment method.');
 if(method===CREDIT)return [{method:CREDIT,amount:Math.round(Number(total)*100)/100}];
 const entries=method==='Mixed payment'?allowed.map(m=>({method:m,amount:Number(mixed[m]||0)})):[{method,amount:Number(paid)}];
 if(entries.some(p=>!Number.isFinite(p.amount)||p.amount<0))throw Error('Enter a valid payment amount.');
 if(entries.some(p=>p.amount>MAX_AMOUNT))throw Error('Amount paid is too large. Check the amount and try again.');
 if(entries.reduce((n,p)=>n+p.amount,0)>Math.max(Number(total)*100,Number(total)+100000))throw Error('Amount paid is far more than the total. Check the amount and try again.');
 const rows=entries.filter(p=>p.amount>0);
 if(!rows.length)throw Error('Enter the amount paid.');
 const sum=rows.reduce((s,p)=>s+cents(p.amount),0);
 if(sum<cents(total))throw Error('Amount paid is below the total.');
 if(sum-cents(total)>rows.filter(p=>p.method==='Cash').reduce((s,p)=>s+cents(p.amount),0))throw Error('Change can only be returned from cash.');
 return rows;
}
