import test from 'node:test';
import assert from 'node:assert/strict';
import {newCampaign,actionRoll,moveToken,parseMasterReply,resolveTurn,MAP} from '../lib/game.mjs';
import {makeMessages} from '../lib/hermes.mjs';

test('uma campanha nova tem dois personagens e mapa válido',()=>{
  const s=newCampaign();
  assert.equal(Object.keys(s.players).length,2);
  assert.equal(s.players.benicio.player,'Benício');
  assert.ok(MAP.every(row=>row.length===12));
});
test('d20 usa número gerado pelo servidor e modificador correto',()=>{
  const s=newCampaign();
  const success=actionRoll(s,'benicio','agilidade',11,()=>12);
  assert.deepEqual({die:success.die,modifier:success.modifier,total:success.total,success:success.success},{die:12,modifier:2,total:14,success:true});
  const fail=actionRoll(s,'joe','engenho',14,()=>2);
  assert.equal(fail.success,false);
});
test('movimento é uma casa, respeita paredes, ocupação e limites',()=>{
  const s=newCampaign();
  assert.throws(()=>moveToken(s,'joe',2,6),/ocupada/);
  assert.throws(()=>moveToken(s,'joe',11,7),/uma casa/);
  assert.throws(()=>moveToken(s,'joe',-1,6),/bloqueada/);
  const result=moveToken(s,'joe',1,5);
  assert.equal(result.players.joe.position.y,5);
  assert.equal(s.players.joe.position.y,6);
});
test('resposta Hermes em JSON, markdown e texto puro é tratada sem execução',()=>{
  const text='{"narration":"A torre se ilumina","title":"A Torre","choices":["Abrir portão"]}';
  assert.equal(parseMasterReply(text).narration,'A torre se ilumina');
  assert.equal(parseMasterReply('```json\n'+text+'\n```').title,'A Torre');
  assert.equal(parseMasterReply('A história continua.').narration,'A história continua.');
});
test('efeitos do LLM são validados e vida permanece acima de zero',()=>{
  const initial=newCampaign();
  const reply=parseMasterReply(JSON.stringify({narration:'Teste',title:'Sala 2',choices:['Prossiga'],effects:[
    {actor:'benicio',hpDelta:-100,addItem:'Chave dourada'},
    {actor:'joe',hpDelta:-2,addItem:'Bússola especial'},
    {actor:'shell',hpDelta:-2,addItem:'não'},
  ]}));
  const updated=resolveTurn(initial,'joe','Vou procurar a porta',null,reply);
  assert.equal(updated.players.benicio.hp,8);
  assert.equal(updated.players.joe.hp,6);
  assert.ok(updated.players.joe.items.includes('Bússola especial'));
  assert.equal(updated.events.at(-1).kind,'master');
});
test('Hermes recebe estado do jogo, resultado verificável e regras',()=>{
  const msgs=makeMessages(newCampaign(),'benicio','Examino a torre',{die:15,modifier:2,total:17,dc:11,success:true});
  assert.match(msgs[0].content,/SOMENTE com um único objeto JSON/);
  assert.match(msgs[1].content,/"total":17/);
  assert.match(msgs[1].content,/Examino a torre/);
});
