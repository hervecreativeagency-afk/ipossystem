import {supabase} from './supabase';
export const unwrap=({data,error})=>{if(error)throw error;return data};
export async function list(table,cid){let all=[];for(let start=0;;start+=1000){const rows=unwrap(await supabase.from(table).select('*').eq('company_id',cid).order(table==='products'?'name':'created_at',{ascending:table==='products'}).order('id').range(start,start+999));all.push(...rows);if(rows.length<1000)break;}return all;}
export const rpc=async(name,args)=>unwrap(await supabase.rpc(name,args));
export {today,monthStart,dateBounds,downloadCSV,cashbookLedger} from './operation-utils';
