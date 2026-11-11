/* Optional online features for Jensen vs Alice. No dependency may block the game loop. */
(function () {
  'use strict';
  const site='https://al3xyar0.github.io/jensen_vs_alice/';
  const config=window.JVA_SUPABASE||{};
  const ready=Boolean(config.url && config.publishableKey && !String(config.url).includes('REPLACE'));
  const api=ready?config.url.replace(/\/$/,'')+'/functions/v1/game-api/':'';
  const state={client:null,user:null,sessionId:null,visitId:null,started:0,events:[],inflight:false,rank:null,results:null,range:'all',nickname:'',online:false};
  const uuid=()=>crypto.randomUUID();
  const $=id=>document.getElementById(id);
  const safe=(s)=>String(s==null?'':s);
  const show=(el,yes)=>{if(el)el.hidden=!yes};
  function setupUI(){
    const css=document.createElement('style');css.textContent=`
      .hallEntry{padding:8px 0 0;text-align:center;color:#b5c9b8;font:700 11px 'Silkscreen',monospace}
      .hallEntry #jvaTop10{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;max-width:410px;margin:7px auto 0;font:10px monospace;color:#a8c7aa;text-align:left}.hallEntry button,.jvaButton{background:#192a2a;border:1px solid #536954;color:#dafaaf;padding:7px 11px;font:700 11px 'Silkscreen',monospace;cursor:pointer}
      .hallEntry button:hover,.jvaButton:hover{border-color:#9be96a}
      .jvaModal[hidden],.jvaScores[hidden]{display:none!important}
      .jvaModal{position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:#040b10ed;padding:12px}
      .jvaSheet{width:min(610px,100%);max-height:90vh;overflow:auto;background:#102025;border:2px solid #54705b;box-shadow:8px 8px #050b0e;padding:20px;color:#eaf3df;font:13px 'Silkscreen',monospace}
      .jvaSheet h2{color:#a4fa77;font:700 clamp(18px,3vw,26px) 'Silkscreen',monospace;margin:0 0 15px}
      .jvaSheet input{background:#07161c;color:#fff;border:1px solid #6c907d;padding:10px;font:14px monospace;max-width:100%;width:220px}
      .jvaFilters,.jvaActions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}
      .jvaBoard{width:100%;border-collapse:collapse;font:12px monospace;text-align:left}
      .jvaBoard th{color:#8ea89c;border-bottom:1px solid #53685a;padding:7px 4px}
      .jvaBoard td{padding:8px 4px;border-bottom:1px solid #283c3c}
      .jvaBoard tr:nth-child(1) td:first-child{color:#ffe18b}.jvaBoard tr:nth-child(2) td:first-child{color:#d4dfe6}.jvaBoard tr:nth-child(3) td:first-child{color:#e1ae83}
      .jvaMuted{font:12px monospace;color:#9dafaa}
      .jvaEndPanel{margin:12px auto 8px;padding:12px;max-width:440px;background:#142523;border-top:1px solid #536857}
      .jvaEndPanel[hidden]{display:none}.jvaEndPanel .jvaActions{justify-content:center}
      .jvaEndPanel input{width:170px;padding:7px;background:#0b1b1f;color:#fff;border:1px solid #6a916c}
      @media(max-width:550px){.jvaSheet{padding:12px}.jvaBoard{font-size:10px}.hallEntry{font-size:9px}}
    `;document.head.append(css);
    const intro=document.querySelector('#overlay .modal');
    if(intro){
      const row=document.createElement('div');row.className='hallEntry';row.innerHTML='<button id="jvaOpenBoard" type="button">WALL STREET HALL OF FAME</button><div id="jvaTop10" class="jvaMuted" style="margin-top:8px"></div>';intro.append(row);
      $('jvaOpenBoard').onclick=()=>openLeaderboard();
      const panel=document.createElement('div');panel.className='jvaEndPanel';panel.id='jvaEndPanel';panel.hidden=true;
      panel.innerHTML='<div id="jvaFinal" class="jvaMuted"></div><div class="jvaActions"><input id="jvaNick" maxlength="20" placeholder="Nickname (max 20)" aria-label="Nickname"><button id="jvaSubmit" class="jvaButton" type="button">SUBMIT SCORE</button></div><p id="jvaResult" class="jvaMuted" role="status"></p><div class="jvaActions"><button id="jvaShare" class="jvaButton" type="button">SHARE ON X</button><button id="jvaFullBoard" class="jvaButton" type="button">LEADERBOARD</button></div>';
      intro.append(panel);
      $('jvaSubmit').onclick=submit;
      $('jvaShare').onclick=share;
      $('jvaFullBoard').onclick=()=>openLeaderboard();
    }
    const modal=document.createElement('div');modal.className='jvaModal';modal.id='jvaModal';modal.hidden=true;
    modal.innerHTML='<section class="jvaSheet" role="dialog" aria-modal="true" aria-label="Global leaderboard"><h2>WALL STREET HALL OF FAME</h2><div class="jvaFilters"><button class="jvaButton" data-range="all">ALL TIME</button><button class="jvaButton" data-range="week">THIS WEEK</button><button class="jvaButton" data-range="today">TODAY</button><button class="jvaButton" id="jvaClose">CLOSE</button></div><p id="jvaLoading" class="jvaMuted"></p><table class="jvaBoard"><thead><tr><th>RANK</th><th>NICKNAME</th><th>SCORE</th><th>WAVE</th></tr></thead><tbody id="jvaRows"></tbody></table></section>';
    document.body.append(modal);
    $('jvaClose').onclick=()=>show(modal,false);
    modal.addEventListener('click',e=>{if(e.target===modal)show(modal,false)});
    modal.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>loadBoard(b.dataset.range,100));
  }
  async function request(path,method='GET',body){
    if(!state.client||!state.user)throw new Error('Leaderboard connection unavailable');
    const {data,error}=await state.client.auth.getSession();if(error||!data.session)throw new Error('Sign-in expired');
    const url=api+path;
    const response=await fetch(url,{method,headers:{'apikey':config.publishableKey,'authorization':'Bearer '+data.session.access_token,'content-type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Server unreachable');return result;
  }
  async function init(){
    if(!ready){$('jvaTop10').textContent='Online ranking coming soon';return}
    try {
      const mod=await import('https://esm.sh/@supabase/supabase-js@2.57.0');
      state.client=mod.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      let {data:{session}}=await state.client.auth.getSession();
      if(!session){const r=await state.client.auth.signInAnonymously();if(r.error)throw r.error;session=r.data.session}
      state.user=session.user;state.online=true;
      let previous=null;try{previous=localStorage.getItem('jva_prev_visit')}catch{}
      state.visitId=uuid();
      const ref=(()=>{try{return new URL(document.referrer).hostname.slice(0,120)}catch{return ''}})();
      const query=new URLSearchParams(location.search);
      request('visit','POST',{visitId:state.visitId,device:device(),referrer:ref,utmSource:(query.get('utm_source')||'').slice(0,80)}).catch(()=>{});
      try{localStorage.setItem('jva_prev_visit',new Date().toISOString())}catch{}
      event('page_view',{device:device(),returning:!!previous});
      if(state.sessionId){await request('start','POST',{sessionId:state.sessionId}).catch(()=>{});event('game_start');event('wave_start',{wave:1,valuation:3750,score:0})}
      if($('jvaSubmit'))$('jvaSubmit').disabled=false;
      loadTop10();
    } catch(error){console.warn('Online scores disabled:',error);$('jvaTop10').textContent='Offline mode — gameplay unaffected'}
  }
  function device(){const w=Math.min(screen?.width||innerWidth,innerWidth);return w<600?'mobile':w<1024?'tablet':'desktop'}
  function event(name,properties={}){
    if(!state.online)return;
    if(!['page_view','game_start','wave_start','wave_complete','market_shock','alice_hit','jensen_hit','powerup_collected','boss_spawned','boss_defeated','game_over','game_victory','score_submitted'].includes(name))return;
    state.events.push({id:uuid(),name,sessionId:state.sessionId,visitId:state.visitId,properties});
    if(state.events.length>=20)flush();
  }
  async function flush(){
    if(state.inflight||!state.events.length||!state.online)return;
    const batch=state.events.splice(0,40);state.inflight=true;
    try{await request('events','POST',{events:batch})}catch(e){console.warn('Analytics deferred:',e);state.events.unshift(...batch.slice(0,20))}finally{state.inflight=false}
  }
  function start(){state.sessionId=uuid();state.started=Date.now();state.results=null;state.rank=null;show($('jvaEndPanel'),false);
    if(state.online){request('start','POST',{sessionId:state.sessionId}).then(()=>{event('game_start');event('wave_start',{wave:1,valuation:3750,score:0})}).catch(e=>console.warn('Session not synced',e))}
  }
  function finish(victory,score,wave,valuation){
    state.results={victory,score,wave,valuation};
    const panel=$('jvaEndPanel');if(panel)show(panel,true);
    if($('jvaFinal'))$('jvaFinal').textContent=`${victory?'MISSION ACCOMPLISHED':'MISSION FAILED'}  |  ${Number(score).toLocaleString()} PTS  |  WAVE ${wave}  |  $${(Number(valuation)/1000).toFixed(2)}T`;
    if($('jvaResult'))$('jvaResult').textContent=state.online?'Enter a nickname to join the global ranking':'Offline: ranking unavailable until connected';
    if($('jvaSubmit'))$('jvaSubmit').disabled=!state.online;
    event(victory?'game_victory':'game_over',{score,wave,valuation,duration:Math.floor((Date.now()-state.started)/1000)});flush();
  }
  async function submit(){
    if(!state.results||!state.online)return;
    const nick=($('jvaNick').value||'').trim();if(!nick||nick.length>20){$('jvaResult').textContent='Enter a nickname (1–20 chars)';return}
    const b=$('jvaSubmit');b.disabled=true;$('jvaResult').textContent='Submitting…';
    try{const result=await request('submit','POST',{sessionId:state.sessionId,nickname:nick,...state.results});
      if(!result.accepted)throw new Error(result.reason||'Score not accepted');
      state.rank=result.rank;state.nickname=nick;
      $('jvaResult').textContent=result.rank?'YOUR GLOBAL RANK: #'+result.rank+'  —  BEST SCORE '+result.bestScore.toLocaleString():'Score accepted. Rank pending.';
      event('score_submitted',{score:state.results.score,rank:result.rank||0});flush();loadTop10();
    }catch(e){$('jvaResult').textContent='Could not submit: '+e.message; b.disabled=false}
  }
  function share(){if(!state.results)return;const p=state.results;const text=`I survived ${p.wave} waves of Alices and defended NVIDIA with ${p.score.toLocaleString()} points! 💍💸${state.rank?' Global rank #'+state.rank+'.':''}\nCan you beat my score?\n🎮 ${site}`;window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text),'_blank','noopener,noreferrer')}
  function renderRows(rows){const body=$('jvaRows');body.replaceChildren();for(const r of rows){const tr=document.createElement('tr');for(const val of ['#'+r.rank,r.nickname,Number(r.score).toLocaleString(),String(r.wave)+'/10']){const td=document.createElement('td');td.textContent=val;tr.append(td)}body.append(tr)}}
  async function loadBoard(range='all',limit=100){
    if(!$('jvaLoading'))return;
    $('jvaLoading').textContent='Loading rankings…';$('jvaRows').replaceChildren();
    try{const response=await request('leaderboard?range='+range+'&limit='+limit);renderRows(response.rows);$('jvaLoading').textContent=response.rows.length?'':'No scores yet. Be first.'}
    catch(e){$('jvaLoading').textContent='Could not load rankings: '+e.message}
  }
  async function loadTop10(){if(!$('jvaTop10'))return;try{const res=await request('leaderboard?range=all&limit=10');const panel=$('jvaTop10');panel.replaceChildren();if(!res.rows.length){panel.textContent='No scores yet — be first.';return}for(const row of res.rows.slice(0,10)){const line=document.createElement('span');line.textContent=`#${row.rank} ${row.nickname}: ${Number(row.score).toLocaleString()}`;panel.append(line)}}catch{$('jvaTop10').textContent='Rankings temporarily unavailable'}}
  function openLeaderboard(){show($('jvaModal'),true);loadBoard(state.range,100)}
  window.JVAOnline={start,finish,event,flush,openLeaderboard,get state(){return state}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setupUI();init()});else{setupUI();init()}
  setInterval(flush,12000);
  window.addEventListener('pagehide',()=>{flush()});
})();