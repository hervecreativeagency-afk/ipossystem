import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let valid = false;
try { valid = !!key && new URL(url).protocol === 'https:'; if(key?.startsWith('sb_secret_')) valid=false; if(key?.split('.').length===3 && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role') valid=false; } catch {valid=false;}
export const configured = valid;
export const supabase = valid ? createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}) : null;
