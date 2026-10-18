import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const pin='familyTest789';
const admin='adminTest123';
async function boot(env) {
  const data=mkdtempSync(join(tmpdir(),'hermes-rpg-test-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',APP_PIN:pin,ADMIN_PIN:admin,DATA_DIR:data,...env},stdio:['ignore','pipe','pipe']});
  let output='';
  const port=await new Promise((ok,fail)=>{
    const timer=setTimeout(()=>fail(new Error('Timeout starting server. '+output)),5000);
    child.on('error',fail);child.on('exit',code=>fail(new Error('Process exited '+code+' '+output)));
    child.stdout.on('data',d=>{output+=d.toString();const m=output.match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);ok(Number(m[1]));}});
    child.stderr.on('data',d=>{output+=d.toString()});
  });
  const url=`http://127.0.0.1:${port}`;
  const request=async(path,body,headers={})=>{const res=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'x-app-pin':pin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  return {data,child,url,request,close:()=>{child.kill();rmSync(data,{recursive:true,force:true})}};
}

test('API demonstração: autenticação, dado, estado, movimento, reset',async()=>{
  const app=await boot({HERMES_MODE:'demo',HERMES_API_KEY:''});
  try {
    let response=await fetch(app.url+'/api/state');assert.equal(response.status,401);
    assert.equal((await app.request('/api/state')).data.players.benicio.hp,8);
    const turn=await app.request('/api/action',{actor:'benicio',action:'Vou conversar com o guardião',stat:'engenho',dc:11});
    assert.equal(turn.status,200);
    assert.equal(typeof turn.data.roll.die,'number');
    const state=(await app.request('/api/state')).data;
    assert.equal(state.revision,1);
    assert.match(state.scene.narration,/DEMONSTRAÇÃO SEM HERMES/);
    const move=await app.request('/api/move',{actor:'benicio',x:2,y:5});assert.equal(move.status,200);
    const denied=await app.request('/api/reset',{}, {'x-admin-pin':'wrong'});assert.equal(denied.status,403);
    const reset=await app.request('/api/reset',{}, {'x-admin-pin':admin});assert.equal(reset.status,200);
    assert.equal((await app.request('/api/state')).data.revision,0);
  } finally{app.close();}
});

test('integração real HTTP: backend envia Chat Completions e interpreta resposta simulada',async()=>{
  let received=null;
  const mock=createServer(async(req,res)=>{
    let body='';for await (const c of req) body+=c;
    if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return;}
    received={path:req.url,auth:req.headers.authorization,body:JSON.parse(body)};
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({title:'Ponte antiga',objective:'Atravessar a ponte',narration:'O guardião acena e oferece uma chave.',choices:['Pegar chave','Conversar'],effects:[{actor:'benicio',hpDelta:0,addItem:'Chave antiga'}]})}}]}));
  });
  await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));
  const port=mock.address().port;
  const app=await boot({HERMES_MODE:'hermes',HERMES_API_KEY:'secret123',HERMES_URL:`http://127.0.0.1:${port}/v1/chat/completions`,HERMES_MODEL:'rpg-mestre'});
  try{
    const turn=await app.request('/api/action',{actor:'benicio',action:'Olho a chave no chão',stat:'nenhum',dc:11});
    assert.equal(turn.status,200);
    assert.equal(received.path,'/v1/chat/completions');
    assert.equal(received.auth,'Bearer secret123');
    assert.equal(received.body.model,'rpg-mestre');
    assert.equal(received.body.messages[0].role,'system');
    const state=(await app.request('/api/state')).data;
    assert.equal(state.scene.title,'Ponte antiga');
    assert.ok(state.players.benicio.items.includes('Chave antiga'));
  }finally{app.close();await new Promise(ok=>mock.close(ok));}
});
