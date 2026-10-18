import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { newCampaign, moveToken, actionRoll, parseMasterReply, resolveTurn, demoMasterReply, MAP } from './lib/game.mjs';
import { askHermes } from './lib/hermes.mjs';

const BASE = dirname(fileURLToPath(import.meta.url));
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || Object.hasOwn(process.env,m[1])) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
    process.env[m[1]] = value;
  }
}
loadDotEnv(join(BASE,'.env'));
const config = {
  host:process.env.HOST || '127.0.0.1',
  port:Number(process.env.PORT || 8787),
  pin:process.env.APP_PIN || '',
  adminPin:process.env.ADMIN_PIN || '',
  dataDir:resolve(BASE,process.env.DATA_DIR || './data'),
  mode:process.env.HERMES_MODE || 'hermes',
  hermesUrl:process.env.HERMES_URL || 'http://127.0.0.1:8650/v1/chat/completions',
  hermesModel:process.env.HERMES_MODEL || 'rpg-mestre',
  hermesKey:process.env.HERMES_API_KEY || '',
  timeoutMs:Number(process.env.HERMES_TIMEOUT_MS || 65000),
};
if (config.pin.length < 6) throw new Error('Configure APP_PIN com ao menos 6 caracteres em .env');
if (!['hermes','demo'].includes(config.mode)) throw new Error('HERMES_MODE deve ser hermes ou demo');
if (config.mode === 'hermes' && !config.hermesKey) throw new Error('Configure HERMES_API_KEY em .env, ou use HERMES_MODE=demo');
if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('PORT inválida');
mkdirSync(config.dataDir,{recursive:true});
const savePath = join(config.dataDir,'campaign.json');
let campaign = existsSync(savePath) ? JSON.parse(readFileSync(savePath,'utf8')) : newCampaign();
let busy = false;
const denied = new Map();

function save(state) {
  const temp = savePath + '.' + randomUUID() + '.tmp';
  writeFileSync(temp,JSON.stringify(state,null,2),'utf8');
  renameSync(temp,savePath);
  campaign = state;
}
if (!existsSync(savePath)) save(campaign);
const eq = (a,b) => {const left=createHash('sha256').update(a).digest();const right=createHash('sha256').update(b).digest();return timingSafeEqual(left,right);};
function setHeaders(res,contentType='application/json; charset=utf-8') {
  res.setHeader('Content-Type',contentType);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'");
}
function json(res,status,data) {setHeaders(res);res.writeHead(status);res.end(JSON.stringify(data));}
function fail(res,status,message) {json(res,status,{error:message});}
function authorized(req,admin=false) {
  const secret = admin ? config.adminPin : config.pin;
  return Boolean(secret) && eq(String(req.headers['x-app-pin'] || ''),secret);
}
function throttle(req) {
  const ip=req.socket.remoteAddress || '?';const now=Date.now();
  const previous=denied.get(ip) || [];const recent=previous.filter(t=> now-t < 60000);
  recent.push(now);denied.set(ip,recent);
  return recent.length > 20;
}
function assertAuth(req,res) {
  if (authorized(req)) return true;
  if (throttle(req)) {fail(res,429,'Muitas tentativas de autenticação. Aguarde um minuto.');return false;}
  fail(res,401,'PIN incorreto');return false;
}
async function readBody(req) {
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>16384) throw new Error('Mensagem muito grande');chunks.push(chunk);}
  let obj;
  try {obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('JSON inválido');}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Objeto JSON obrigatório');
  return obj;
}
function validateAction(obj) {
  if (!['joe','benicio'].includes(obj.actor)) throw new Error('Jogador inválido');
  if (typeof obj.action !== 'string' || obj.action.trim().length < 2 || obj.action.trim().length > 240) throw new Error('Ação deve ter entre 2 e 240 caracteres');
  if (!['nenhum','coragem','agilidade','engenho'].includes(obj.stat ?? 'nenhum')) throw new Error('Atributo inválido');
  if (obj.stat !== 'nenhum' && obj.stat !== undefined && ![9,11,14].includes(obj.dc)) throw new Error('Dificuldade inválida');
}
const types={'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8','js':'application/javascript; charset=utf-8'};
const publicPaths={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css'};

const server = http.createServer(async (req,res)=>{
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return json(res,200,{status:'ok',app:'hermes-rpg'});
    if (req.method === 'GET' && Object.hasOwn(publicPaths,path)) {
      const f = publicPaths[path];
      setHeaders(res,types[extname(f).slice(1)]);
      res.writeHead(200);res.end(readFileSync(join(BASE,'public',f)));return;
    }
    if (!path.startsWith('/api/')) return fail(res,404,'Rota não encontrada');
    if (!assertAuth(req,res)) return;
    if (req.method === 'GET' && path === '/api/state') return json(res,200,{...campaign,map:MAP,busy,mode:config.mode});
    if (req.method === 'GET' && path === '/api/status') {
      let hermes = config.mode === 'demo' ? 'demo' : 'offline';
      if (config.mode === 'hermes') {
        try {
          const healthUrl = new URL(config.hermesUrl);healthUrl.pathname='/health';healthUrl.search='';
          const response = await fetch(healthUrl,{signal:AbortSignal.timeout(2500)});
          hermes = response.ok ? 'online' : 'offline';
        } catch {} // Availability is advisory: health OK is not proof the model can complete a turn.
      }
      return json(res,200,{mode:config.mode,hermes,model:config.hermesModel,busy});
    }
    if (req.method !== 'POST') return fail(res,405,'Método não permitido');
    if (path === '/api/reset') {
      if (!authorized({headers:{'x-app-pin':req.headers['x-admin-pin']}},true)) return fail(res,403,'PIN de administrador incorreto ou não configurado');
      if (busy) return fail(res,409,'O mestre está respondendo');
      save(newCampaign());return json(res,200,{ok:true,revision:campaign.revision});
    }
    if (busy) return fail(res,409,'O mestre está respondendo. Aguarde o turno terminar.');
    const body = await readBody(req);
    if (path === '/api/move') {
      const updated=moveToken(campaign,body.actor,body.x,body.y);
      save(updated);return json(res,200,{ok:true,revision:campaign.revision});
    }
    if (path === '/api/action') {
      validateAction(body);
      busy=true;
      try {
        const stat=body.stat??'nenhum';
        const roll=actionRoll(campaign,body.actor,stat,stat==='nenhum'?11:body.dc);
        const raw=config.mode==='demo' ? demoMasterReply(campaign,body.actor,body.action.trim(),roll)
          : parseMasterReply(await askHermes(config,campaign,body.actor,body.action.trim(),roll));
        const updated=resolveTurn(campaign,body.actor,body.action.trim(),roll,raw);
        save(updated);
        return json(res,200,{ok:true,revision:updated.revision,roll,narration:updated.scene.narration});
      } finally {busy=false;}
    }
    return fail(res,404,'Rota não encontrada');
  } catch (error) {
    console.error('[hermes-rpg]',error.message);
    const isClient=/inválid|bloquead|ocupad|Movimento|caracteres|grande|obrigatório|fora do mapa/.test(error.message);
    return fail(res,isClient?400:502,isClient?error.message:`Erro do servidor: ${error.message.slice(0,250)}`);
  }
});
server.listen(config.port,config.host,()=>console.log(`Hermes RPG [${config.mode}]: http://${config.host}:${server.address().port}  · Hermes: ${config.hermesUrl}`));
export {server,config};
