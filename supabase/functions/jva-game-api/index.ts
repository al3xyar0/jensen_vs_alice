import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const URL = Deno.env.get('SUPABASE_URL')!;
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const GAME_ORIGIN = 'https://al3xyar0.github.io';
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : GAME_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Vary': 'Origin',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});
function respond(body: unknown, status=200, origin: string | null=null) {
  return new Response(JSON.stringify(body), {status,headers:cors(origin)});
}
function validUUID(v: unknown): v is string { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
const int = (x: unknown, low: number, high: number): x is number => Number.isSafeInteger(x) && (x as number)>=low && (x as number)<=high;
const num = (x: unknown, low: number, high: number): x is number => typeof x === 'number' && Number.isFinite(x) && x>=low && x<=high;
const clean = (x: unknown, max: number) => typeof x==='string' ? x.trim().slice(0,max) : '';
const allowed = new Set(['page_view','game_start','wave_start','wave_complete','market_shock','alice_hit','jensen_hit','powerup_collected','boss_spawned','boss_defeated','game_over','game_victory','score_submitted']);
const originAllowed = (o:string|null) => !o || o===GAME_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
async function identity(req:Request) {
  const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if (!jwt) return null;
  const {data,error}=await db.auth.getUser(jwt);
  if(error||!data.user) return null;
  return data.user;
}
async function json(req:Request) {
  if (Number(req.headers.get('content-length')||0)>25000) throw new Error('Payload too large');
  const val=await req.json();
  if(!val||typeof val!=='object'||Array.isArray(val)) throw new Error('Expected JSON object');
  return val as Record<string,unknown>;
}
async function throttle(uid:string, action:'visit'|'start'|'events'|'submit', max:number, perSeconds:number){
 const {data,error}=await db.rpc('game_consume_rate_limit',{
   p_user:uid,p_action:action,p_seconds:perSeconds,p_max:max
 });
 if(error)throw error;
 if(data!==true)throw new Error('Rate limit exceeded');
}
async function leaderboard(url:URL) {
  const range=['today','week','all'].includes(url.searchParams.get('range')||'')?url.searchParams.get('range')!:'all';
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||10));
  // All-time is the single best per player. Weekly and daily derive each
  // player's best accepted score within that window, not their all-time best.
  let q=range==='all'
    ?db.from('game_leaderboard_scores').select('user_id,nickname,score,highest_wave,final_valuation_b,victory,submitted_at')
    :db.from('game_score_submissions').select('user_id,nickname,score,highest_wave,final_valuation_b,victory,submitted_at').eq('status','accepted');
  if(range!=='all')q=q.gte('submitted_at',new Date(Date.now()-(range==='today'?86400000:604800000)).toISOString());
  const {data,error}=await q.order('score',{ascending:false}).order('highest_wave',{ascending:false}).order('submitted_at',{ascending:true}).limit(5000);
  if(error)throw error;
  const seen=new Set<string>();
  const filtered=(data||[]).filter(row=>{if(seen.has(row.user_id))return false;seen.add(row.user_id);return true});
  const result=filtered.slice(0,limit).map((row,i)=>({rank:i+1,nickname:row.nickname,score:row.score,wave:row.highest_wave,valuation:row.final_valuation_b,victory:row.victory,submitted_at:row.submitted_at}));
  return {range,rows:result};
}
async function visit(uid:string,body:Record<string,unknown>){
  await throttle(uid,'visit',40,3600);
  if(!validUUID(body.visitId)) throw new Error('Invalid visit');
  const device = ['desktop','mobile','tablet'].includes(String(body.device))?String(body.device):'desktop';
  const referrer = clean(body.referrer,120);
  const utmSource = clean(body.utmSource,80);
  const {error:err1}=await db.from('game_players').upsert({user_id:uid,last_seen:new Date().toISOString()},{onConflict:'user_id',ignoreDuplicates:true});
  if(err1)throw err1;
  const {error:err2}=await db.from('game_visits').upsert({id:body.visitId,user_id:uid,device,referrer_host:referrer,utm_source:utmSource},{onConflict:'id',ignoreDuplicates:true});
  if(err2)throw err2;
  return {ok:true};
}
async function start(uid:string,body:Record<string,unknown>){
  await throttle(uid,'start',50,3600);
  if(!validUUID(body.sessionId)) throw new Error('Invalid session');
  const {error:e}=await db.from('game_sessions').upsert({id:body.sessionId,user_id:uid},{onConflict:'id',ignoreDuplicates:true});
  if(e) throw e;
  const {count}=await db.from('game_sessions').select('id',{count:'exact',head:true}).eq('user_id',uid);
  await db.from('game_players').upsert({user_id:uid,last_seen:new Date().toISOString(),games_played:count||0},{onConflict:'user_id'});
  return {ok:true};
}
async function events(uid:string,body:Record<string,unknown>){
  if(!Array.isArray(body.events)||body.events.length>40)throw new Error('Invalid event batch');
  await throttle(uid,'events',40,60);
  const entries: Record<string,unknown>[]=[];
  for(const ev of body.events){
    if(!ev||typeof ev!=='object')continue;
    const e=ev as Record<string,unknown>;
    if(!validUUID(e.id)||!allowed.has(String(e.name)))continue;
    if(e.sessionId&&!validUUID(e.sessionId))continue;
    const p=e.properties;
    if(!p||typeof p!=='object'||Array.isArray(p)||JSON.stringify(p).length>1400)continue;
    entries.push({id:e.id,user_id:uid,session_id:validUUID(e.sessionId)?e.sessionId:null,visit_id:validUUID(e.visitId)?e.visitId:null,event_name:e.name,properties:p});
  }
  if(entries.length){
    const ids=[...new Set(entries.map(x=>x.session_id).filter(Boolean))];
    if(ids.length){const {data}=await db.from('game_sessions').select('id').eq('user_id',uid).in('id',ids);const own=new Set((data||[]).map(v=>v.id));for(const e of entries){if(e.session_id&&!own.has(e.session_id as string))throw new Error('Unowned session')}}
    const visitIds=[...new Set(entries.map(x=>x.visit_id).filter(Boolean))];
    if(visitIds.length){const {data}=await db.from('game_visits').select('id').eq('user_id',uid).in('id',visitIds);const own=new Set((data||[]).map(v=>v.id));for(const e of entries){if(e.visit_id&&!own.has(e.visit_id as string))throw new Error('Unowned visit')}}
    const {error}=await db.from('game_events').upsert(entries,{onConflict:'id',ignoreDuplicates:true});
    if(error)throw error;
  }
  return {ok:true,received:entries.length};
}
async function submit(uid:string,body:Record<string,unknown>){
  await throttle(uid,'submit',10,3600);
  const sid=body.sessionId;
  if(!validUUID(sid))throw new Error('Invalid session');
  const nickname=clean(body.nickname,21).replace(/[<>\x00-\x1F\x7F]/g,'');
  if(!nickname||nickname.length>20)throw new Error('Nickname must be 1–20 characters');
  const score=body.score, wave=body.wave, valuation=body.valuation, victory=body.victory;
  if(!int(score,0,10000000)||!int(wave,1,10)||!num(valuation,0,5000)||typeof victory!=='boolean')throw new Error('Invalid result');
  const {data:session,error:serr}=await db.from('game_sessions').select('*').eq('id',sid).eq('user_id',uid).maybeSingle();
  if(serr)throw serr;
  if(!session)throw new Error('Unknown session. Try again online.');
  const {data:prior}=await db.from('game_score_submissions').select('status').eq('session_id',sid).eq('user_id',uid).maybeSingle();
  if(prior){
    const {data:best}=await db.from('game_leaderboard_scores').select('score').eq('user_id',uid).maybeSingle();
    const {data:ranks}=await db.from('game_leaderboard_scores').select('user_id').order('score',{ascending:false}).order('highest_wave',{ascending:false}).order('submitted_at',{ascending:true}).limit(5000);
    const rank=(ranks||[]).findIndex(x=>x.user_id===uid)+1;
    return {accepted:prior.status==='accepted',duplicate:true,bestScore:best?.score||0,rank:rank||null};
  }
  const age=Math.floor((Date.now()-new Date(session.started_at).getTime())/1000);
  const plausible=age>=Math.max(2,(wave-1)*13)&&age<=7200 && score<=Math.min(10000000,20000+age*4000) && (!victory||wave===10) && (victory||valuation<=3500);
  // This is plausibility filtering, NOT cryptographic/authoritative score verification.
  const status=plausible?'accepted':'rejected';
  const details={session_id:sid,user_id:uid,nickname,score,highest_wave:wave,final_valuation_b:valuation,victory,status,reason:plausible?null:'outside gameplay plausibility bounds'};
  const {error:suberr}=await db.from('game_score_submissions').insert(details);
  if(suberr)throw suberr;
  await db.from('game_sessions').update({ended_at:new Date().toISOString(),score,highest_wave:wave,final_valuation_b:valuation,victory,elapsed_seconds:Math.max(0,age),outcome:victory?'victory':'bankruptcy'}).eq('id',sid).eq('user_id',uid);
  if(!plausible)return {accepted:false,reason:'Score failed basic validation'};
  const {data:best}=await db.from('game_leaderboard_scores').select('score,submitted_at').eq('user_id',uid).maybeSingle();
  if(!best || score>best.score){
    const {error:be}=await db.from('game_leaderboard_scores').upsert({user_id:uid,session_id:sid,nickname,score,highest_wave:wave,final_valuation_b:valuation,victory,submitted_at:new Date().toISOString()},{onConflict:'user_id'});
    if(be)throw be;
  }
  await db.from('game_players').update({nickname,last_seen:new Date().toISOString()}).eq('user_id',uid);
  const {data:scores}=await db.from('game_leaderboard_scores').select('user_id,score,highest_wave,submitted_at').order('score',{ascending:false}).order('highest_wave',{ascending:false}).order('submitted_at',{ascending:true}).limit(5000);
  const rank=(scores||[]).findIndex(v=>v.user_id===uid)+1;
  return {accepted:true,rank:rank||null,bestScore:Math.max(score,best?.score||0),isNewBest:!best||score>best.score};
}
async function admin(uid:string,anonymous:boolean,url:URL){
  if(anonymous)throw new Error('Admin requires verified permanent user');
  const {data:authz,error}=await db.from('game_admins').select('user_id').eq('user_id',uid).maybeSingle();
  if(error)throw error;
  if(!authz)throw new Error('Not authorized');
  const days=Math.min(90,Math.max(1,Number(url.searchParams.get('days'))||30));
  const from=new Date(Date.now()-days*86400000).toISOString();
  const [{data:visits},{data:sessions},{data:events}]=await Promise.all([
    db.from('game_visits').select('user_id,occurred_at,device,utm_source').gte('occurred_at',from).limit(10000),
    db.from('game_sessions').select('user_id,started_at,ended_at,score,highest_wave,final_valuation_b,victory,elapsed_seconds').gte('started_at',from).limit(10000),
    db.from('game_events').select('event_name,properties,occurred_at').gte('occurred_at',from).in('event_name',['market_shock','boss_spawned','boss_defeated']).limit(10000),
  ]);
  const v=visits||[],s=sessions||[],e=events||[],end=s.filter(x=>x.ended_at);
  const unique=new Set(v.map(x=>x.user_id));
  const day=(iso:string)=>iso.slice(0,10);
  const byDay:Record<string,{visits:number,games:number}>={};
  for(const x of v){const d=day(x.occurred_at);(byDay[d]??={visits:0,games:0}).visits++}
  for(const x of s){const d=day(x.started_at);(byDay[d]??={visits:0,games:0}).games++}
  const avg=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  const histogram:Record<string,number>={};for(const x of end){const k=String(x.highest_wave||1);histogram[k]=(histogram[k]||0)+1}
  const shocks:Record<string,number>={};for(const x of e.filter(x=>x.event_name==='market_shock')){const k=String(x.properties?.name||'Other').slice(0,60);shocks[k]=(shocks[k]||0)+1}
  return {days,visits:v.length,uniqueVisitors:unique.size,visitorsToday:new Set(v.filter(x=>day(x.occurred_at)===day(new Date().toISOString())).map(x=>x.user_id)).size,
    gamesStarted:s.length,gamesCompleted:end.length,conversion:unique.size?new Set(s.map(x=>x.user_id)).size/unique.size:0,
    averageScore:avg(end.map(x=>x.score||0)),averageWave:avg(end.map(x=>x.highest_wave||1)),averageDuration:avg(end.map(x=>x.elapsed_seconds||0)),
    averageFinalValuation:avg(end.map(x=>Number(x.final_valuation_b)||0)),victoryRate:end.length?end.filter(x=>x.victory).length/end.length:0,
    replayRate:new Set(s.map(x=>x.user_id)).size?1-new Set(s.map(x=>x.user_id)).size/s.length:0,
    returningRate:unique.size?new Set(v.filter(x=>v.some(y=>y.user_id===x.user_id&&y.occurred_at<x.occurred_at)).map(x=>x.user_id)).size/unique.size:0,
    wave3:end.filter(x=>x.highest_wave>=3).length,wave5:end.filter(x=>x.highest_wave>=5).length,wave7:end.filter(x=>x.highest_wave>=7).length,wave10:end.filter(x=>x.highest_wave>=10).length,
    bossSpawns:e.filter(x=>x.event_name==='boss_spawned').length,bossDefeats:e.filter(x=>x.event_name==='boss_defeated').length,
    waveHistogram:histogram,shocks,daily:Object.entries(byDay).sort().map(([date,v])=>({date,...v})),
    devices:Object.fromEntries(['mobile','tablet','desktop'].map(x=>[x,v.filter(z=>z.device===x).length])),
    sources:v.reduce((acc:Record<string,number>,x)=>{const k=x.utm_source||'direct/other';acc[k]=(acc[k]||0)+1;return acc},{}),
    sampled:v.length>=10000||s.length>=10000||e.length>=10000};
}

Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
 if(!originAllowed(origin))return respond({error:'Origin denied'},403,origin);
 const route=new URL(req.url),path=route.pathname.split('/').pop();
 try {
   if(path==='leaderboard'&&req.method==='GET')return respond(await leaderboard(route),200,origin);
   const user=await identity(req);
   if(!user)return respond({error:'Sign in anonymously first'},401,origin);
   const uid=user.id;
   if(path==='admin'&&req.method==='GET')return respond(await admin(uid,Boolean(user.is_anonymous),route),200,origin);
   if(req.method!=='POST')return respond({error:'Not found'},404,origin);
   const body=await json(req);
   let result;
   if(path==='visit')result=await visit(uid,body);
   else if(path==='start')result=await start(uid,body);
   else if(path==='events')result=await events(uid,body);
   else if(path==='submit')result=await submit(uid,body);
   else return respond({error:'Not found'},404,origin);
   return respond(result,200,origin);
 }catch(e){const m=e instanceof Error?e.message:'Request failed';console.error('game-api:',m);const safe=/^(Rate limit|Invalid|Unowned|Unknown session|Nickname|Not authorized|Score failed|Expected JSON|Payload too large)/.test(m)?m:'Request could not be processed';return respond({error:safe},m.includes('Rate limit')?429:m.includes('authorized')?403:400,origin)}
});