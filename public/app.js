const $ = id => document.getElementById(id);
let accessPin = sessionStorage.getItem('hermes-rpg-pin') || '';
let myActor = localStorage.getItem('hermes-rpg-player') || 'joe';
let campaign = null, pending = false, voiceOn = false, lastSpoken = null, lastRevision = -1;
const mapSymbols = {'rock':'◆','joe':'🦊','benicio':'🧭'};

async function api(path,{method='GET',body,adminPin}={}) {
  const headers = {'x-app-pin':accessPin};
  if(body !== undefined) headers['Content-Type'] = 'application/json';
  if(adminPin !== undefined) headers['x-admin-pin'] = adminPin;
  const res = await fetch(path,{method,headers,body: body === undefined ? undefined : JSON.stringify(body),cache:'no-store'});
  let data={};
  try{data = await res.json();}catch{}
  if(res.status===401){openLogin('PIN incorreto. Verifique a configuração do servidor.');throw new Error('PIN incorreto');}
  if(!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
  return data;
}
function openLogin(error=''){$('main').hidden=true;$('login-error').textContent=error;if(!$('login').open)$('login').showModal();}
function n(tag,className,text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function actorName(id){return campaign?.players?.[id]?.hero || 'Mestre Hermes';}

function playerCard(player) {
  const el=n('article','character'+(player.id===myActor?' selected':''));
  const head=n('div','character-head');head.append(n('span','avatar',player.emoji));
  const names=n('div');names.append(n('strong',null,player.hero),n('small',null,`Jogador: ${player.player}`));head.append(names);el.append(head);
  const hp=n('div','life',`♥ ${player.hp}/${player.maxHp} vida`);el.append(hp);
  const bar=n('div','hp-track');const fill=n('div','hp-fill');fill.style.width=`${player.hp/player.maxHp*100}%`;bar.append(fill);el.append(bar);
  const stat=n('div','stat-row');for(const [k,v] of Object.entries(player.stats)){const chip=n('span','stat',`${k.charAt(0).toUpperCase()+k.slice(1)} +${v}`);stat.append(chip);}el.append(stat);
  el.append(n('p','items',`🎒 ${player.items.join(' · ')}`));return el;
}
function drawMap() {
  const map=$('map');map.replaceChildren();
  for(let y=0;y<campaign.map.length;y++)for(let x=0;x<campaign.map[y].length;x++){
    const wall=campaign.map[y][x]==='#';
    const tile=n('button',wall?'tile rock':'tile meadow');tile.type='button';tile.setAttribute('role','gridcell');tile.setAttribute('aria-label',`Casa ${x+1}, ${y+1}${wall?', bloqueada':''}`);
    const occupant=Object.values(campaign.players).find(p=>p.position.x===x&&p.position.y===y);
    if(occupant){tile.textContent=occupant.emoji;tile.classList.add('occupied');tile.title=occupant.hero;}
    else if(wall){tile.textContent=mapSymbols.rock;tile.disabled=true;}
    else if(x===9 && y===1){tile.textContent='🏰';tile.title='A Torre';}
    else if(x===5 && y===5){tile.textContent='🍄';tile.title='Cogumelos luminosos';}
    else if(x===0 && y===1){tile.textContent='🌲';tile.title='Bosque';}
    else tile.textContent=(x+y)%4===0?'·':'';
    if(!wall)tile.addEventListener('click',()=>move(x,y));
    map.append(tile);
  }
}
function renderEvents() {
  const root=$('events');root.replaceChildren();
  for(const event of [...campaign.events].reverse().slice(0,24)){
    const item=n('div','event '+(event.kind==='master'?'master':'player'));
    const h=n('div','event-head',event.kind==='master'?'✦ Mestre Hermes':`➤ ${actorName(event.actor)}`);
    const time=n('span','tiny',new Date(event.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));h.append(time);item.append(h);
    item.append(n('div','event-body',event.text));
    if(event.roll){const {die,modifier,total,dc,stat,success}=event.roll;item.append(n('div','roll-chip',`🎲 ${stat}: ${die} + ${modifier} = ${total} / ${dc} · ${success?'SUCESSO':'FALHA'}`));}
    if(event.effects?.length)item.append(n('div','effect-chip',event.effects.join(' | ')));
    root.append(item);
  }
}
function speak(text) {
  if(!voiceOn||!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();const s=new SpeechSynthesisUtterance(text);s.lang='pt-BR';s.rate=.93;s.pitch=1;
  const voices=window.speechSynthesis.getVoices();s.voice=voices.find(v=>v.lang.toLowerCase().startsWith('pt-br')) || null;
  window.speechSynthesis.speak(s);
}
function render() {
  if(!campaign)return;
  $('who').value=myActor;
  const characters=$('characters');characters.replaceChildren();
  Object.values(campaign.players).forEach(p=>characters.append(playerCard(p)));
  $('scene-title').textContent=campaign.scene.title;
  $('scene-objective').textContent=`MISSÃO: ${campaign.scene.objective}`;
  $('narration').textContent=campaign.scene.narration;
  $('revision').textContent=`Etapa ${campaign.events.filter(e=>e.kind==='player').length+1}`;
  $('mode-chip').textContent=campaign.mode==='demo'?'Modo demonstração — sem IA':'Hermes Agent · RPG';
  $('mode-chip').classList.toggle('demo',campaign.mode==='demo');
  $('busy-chip').hidden=!campaign.busy&&!pending;
  $('send').disabled=campaign.busy||pending;
  $('send').textContent=campaign.busy||pending?'Mestre pensando…':'Enviar ação ao Mestre →';
  const ch=$('choices');ch.replaceChildren();
  for(const option of campaign.scene.choices){const btn=n('button','choice',option+' ↗');btn.type='button';btn.addEventListener('click',()=>{$('action').value=option;$('action').focus();});ch.append(btn);}
  drawMap();renderEvents();
  const newest=[...campaign.events].reverse().find(e=>e.kind==='master');
  if(newest && newest.id!==lastSpoken){lastSpoken=newest.id;if(lastRevision>=0)speak(newest.text);}
  lastRevision=campaign.revision;
}
async function refresh(silent=false){
  if(!accessPin)return;
  try{const result=await api('/api/state');if(!campaign||campaign.revision!==result.revision||campaign.busy!==result.busy){campaign=result;render();}$('main').hidden=false;}
  catch(e){if(!silent)feedback(e.message,true);throw e;}
}
function feedback(message,err=false){$('feedback').textContent=message;$('feedback').className='help '+(err?'error':'');}
async function move(x,y){
  if(pending||campaign?.busy)return;
  try{await api('/api/move',{method:'POST',body:{actor:myActor,x,y}});await refresh(true);}
  catch(e){feedback(e.message,true);}
}
async function submitAction(event){
  event.preventDefault();if(pending||campaign?.busy)return;
  const action=$('action').value.trim();if(action.length<2)return;
  const stat=$('stat').value;const body={actor:myActor,action,stat,dc:Number($('dc').value)};
  pending=true;render();feedback('O Mestre está preparando a próxima cena…');
  try{const result=await api('/api/action',{method:'POST',body});$('action').value='';feedback(result.roll?`🎲 ${result.roll.die} + ${result.roll.modifier} = ${result.roll.total} — ${result.roll.success?'sucesso':'falha'}.`:'Sua ação foi narrada pelo mestre.');}
  catch(e){feedback(e.message,true);}
  finally{pending=false;await refresh(true).catch(()=>{});if(campaign)render();}
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();accessPin=$('pin').value.trim();
  try{await refresh();sessionStorage.setItem('hermes-rpg-pin',accessPin);$('login').close();$('main').hidden=false;}
  catch(e){$('login-error').textContent=e.message;}
});
$('who').addEventListener('change',event=>{myActor=event.target.value;localStorage.setItem('hermes-rpg-player',myActor);render();});
$('action-form').addEventListener('submit',submitAction);
$('refresh').addEventListener('click',()=>refresh());
$('print').addEventListener('click',()=>window.print());
$('speak-toggle').addEventListener('click',()=>{
  if(!('speechSynthesis' in window)){feedback('Síntese de voz não suportada neste navegador.',true);return;}
  voiceOn=!voiceOn;$('speak-toggle').textContent=voiceOn?'🔊 Voz: ligada':'🔈 Voz: desligada';
  if(voiceOn)speak(campaign?.scene?.narration||'');else window.speechSynthesis.cancel();
});
$('reset').addEventListener('click',async()=>{
  if(!confirm('Reiniciar toda a campanha? O histórico anterior será substituído.'))return;
  const adminPin=prompt('Digite o PIN de administrador:');if(!adminPin)return;
  try{await api('/api/reset',{method:'POST',adminPin});lastSpoken=null;lastRevision=-1;await refresh();feedback('A campanha foi reiniciada.');}catch(e){feedback(e.message,true);}
});
if(accessPin){refresh().catch(()=>openLogin());}else openLogin();
setInterval(()=>{if(accessPin&&!document.hidden)refresh(true).catch(()=>{});},2500);
