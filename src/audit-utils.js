const labels={selling_price:'Selling price',unit_cost:'Purchase cost',stock_quantity:'Stock quantity',low_stock_threshold:'Low-stock threshold',tax_rate:'Tax rate',active:'Account enabled',full_name:'Full name',sku:'SKU',tpin:'TPIN',receipt_footer:'Receipt thank-you message',receipt_paper:'Receipt paper size',before_data:'Previous details',after_data:'Updated details'};
export function auditLabel(key){return labels[key]||key.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
const internal=new Set(['id','company_id','user_id','actor_id','invited_by','request_id','updated_at','created_at']);
export function auditChanges(before,after){const a=before||{},b=after||{};return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!internal.has(k)&&JSON.stringify(a[k])!==JSON.stringify(b[k])).map(key=>({key,label:auditLabel(key),before:a[key],after:b[key]}));}
export function auditValue(key,value,currency='ZMW'){
 if(value===null||value===undefined||value==='')return '—';
 if(typeof value==='boolean')return value?'Yes':'No';
 if(Array.isArray(value))return value.map((v,i)=>`${i+1}. ${auditValue(key,v,currency)}`).join('\n')||'None';
 if(typeof value==='object')return Object.entries(value).filter(([k])=>!internal.has(k)).map(([k,v])=>`${auditLabel(k)}: ${auditValue(k,v,currency)}`).join('\n')||'—';
 if((typeof value==='number'||/^\d+(\.\d+)?$/.test(String(value)))&&/price|cost|cash|amount|total|discount|variance|balance/.test(key)&&!key.endsWith('_id'))return new Intl.NumberFormat('en-ZM',{style:'currency',currency}).format(Number(value));
 if(key==='tax_rate')return `${value}%`;
 if(/_at$/.test(key)&&Number.isFinite(Date.parse(value)))return new Date(value).toLocaleString('en-ZM',{timeZone:'Africa/Lusaka'});
 return String(value).replace(/^([a-z]+)_([a-z]+)$/,(_,a,b)=>a+' '+b);
}
