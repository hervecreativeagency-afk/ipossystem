export const cents = n => Math.round(Number(n)*100);
export function totals(cart,discount=0){
 const subtotal=cart.reduce((s,i)=>s+cents(i.selling_price)*i.quantity,0);
 const d=cents(discount);
 if(!Number.isFinite(d)||d<0||d>subtotal)throw Error('Discount must be between zero and the subtotal.');
 const tax=cart.reduce((s,i)=>s+Math.round(cents(i.selling_price)*i.quantity*(subtotal ? (subtotal-d)/subtotal:1)*Number(i.tax_rate)/100),0);
 return {subtotal:subtotal/100,discount:d/100,tax:tax/100,total:(subtotal-d+tax)/100};
}
export function validateCart(cart){if(!cart.length)throw Error('Add at least one product.'); for(const i of cart){if(!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>i.stock_quantity)throw Error(`Insufficient stock for ${i.name}.`);} }
export const paymentMethods=['Cash','Airtel Money','MTN Money','Bank/Card'];
export function paymentRows(method,paid,mixed,total){const rows=method==='Mixed payment'?paymentMethods.map(m=>({method:m,amount:Number(mixed[m]||0)})).filter(p=>p.amount>0):[{method,amount:Number(paid)}];if(rows.some(p=>!Number.isFinite(p.amount)||p.amount<0))throw Error('Enter a valid payment amount.');const sum=rows.reduce((s,p)=>s+cents(p.amount),0);if(sum<cents(total))throw Error('Amount paid is below the total.');if(sum-cents(total)>rows.filter(p=>p.method==='Cash').reduce((s,p)=>s+cents(p.amount),0))throw Error('Change can only be returned from cash.');return rows;}
