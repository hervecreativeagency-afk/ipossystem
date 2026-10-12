import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const origin='https://ipos-retail-frontend.jollywasp32.chatgpt.site';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'Sign in first'},401);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(token);if(authError||!auth.user)return reply({error:'Your session has expired. Sign in again.'},401);
 let inviteId:string|undefined;
 try{
  const {company_id,full_name,email,role}=await req.json();
  if(typeof company_id!=='string'||typeof full_name!=='string'||full_name.trim().length<2||full_name.length>150||typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['cashier','supervisor'].includes(role))return reply({error:'Enter a valid name, email, and staff role.'},400);
  const {data:member,error:memberError}=await admin.from('company_users').select('role').eq('company_id',company_id).eq('user_id',auth.user.id).eq('active',true).maybeSingle();
  if(memberError||member?.role!=='director')return reply({error:'Only the store director can invite staff.'},403);
  const cleanEmail=email.trim().toLowerCase();
  if(cleanEmail===auth.user.email?.toLowerCase())return reply({error:'You are already the director of this store.'},400);
  const {data:invite,error:insertError}=await admin.from('staff_invitations').insert({company_id,full_name:full_name.trim(),email:cleanEmail,role,invited_by:auth.user.id}).select('id').single();
  if(insertError)return reply({error:insertError.code==='23505'?'A pending invitation already exists for this email.':'Could not create the invitation. Please try again.'},400);
  inviteId=invite.id;
  // Privileged Auth operations stay on the server. The invitation contains a single-use activation link, never a password.
  const {data:userData,error:inviteError}=await admin.auth.admin.inviteUserByEmail(cleanEmail,{data:{full_name:full_name.trim()},redirectTo:origin+'/reset-password'});
  if(inviteError)throw new Error(inviteError.message);
  const uid=userData.user?.id;if(!uid)throw new Error('Supabase did not return an invited user.');
  const {error:profileError}=await admin.from('profiles').upsert({id:uid,full_name:full_name.trim()});if(profileError)throw new Error('Email requested, but profile setup failed. Contact support before retrying.');
  const {error:membershipError}=await admin.from('company_users').insert({company_id,user_id:uid,role,active:true});if(membershipError)throw new Error('Email requested, but membership setup failed. Contact support before retrying.');
  const {error:finishError}=await admin.from('staff_invitations').update({user_id:uid,status:'pending'}).eq('id',inviteId);if(finishError)throw new Error('Membership created, but invitation tracking failed.');
  return reply({success:true,message:'Invitation email requested. The recipient can activate their account and choose a password.'});
 }catch(error){const text=error instanceof Error?error.message:'Invitation failed';if(inviteId)await admin.from('staff_invitations').update({status:'failed',error_message:text}).eq('id',inviteId);return reply({error:text},400)}
});
