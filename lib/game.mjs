import { randomInt, randomUUID } from 'node:crypto';

export const MAP = Object.freeze([
  '............',
  '...##.......',
  '...#........',
  '......###...',
  '.........#..',
  '....##......',
  '............',
  '............',
]);

const now = () => new Date().toISOString();
const clean = (value, max = 800) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const choicesFrom = (items) => (Array.isArray(items) ? items : [])
  .filter(item => typeof item === 'string').map(item => clean(item, 100))
  .filter(Boolean).slice(0, 3);

export function newCampaign() {
  const created = now();
  return {
    schemaVersion: 1,
    revision: 0,
    createdAt: created,
    updatedAt: created,
    adventure: 'O Mistério da Torre Esquecida',
    scene: {
      title: 'A Clareira das Três Trilhas',
      objective: 'Descobrir por que a antiga torre parou de iluminar a floresta.',
      narration: 'Vocês encontram uma pedra brilhante na borda da floresta. À frente há uma ponte de cipós, uma passagem entre raízes e um pequeno sinal deixado por um explorador. Um canto distante ecoa da torre. O que vocês fazem?',
      choices: ['Examinar a pedra brilhante', 'Seguir pela ponte de cipós', 'Investigar o sinal do explorador'],
    },
    players: {
      joe: { id:'joe', player:'Joe', hero:'Téo, o Raposo', emoji:'🦊', hp:8, maxHp:8, stats:{coragem:2, agilidade:1, engenho:1}, items:['Corda', 'Lanterna'], position:{x:1,y:6} },
      benicio: { id:'benicio', player:'Benício', hero:'Beni, o Explorador', emoji:'🧭', hp:8, maxHp:8, stats:{coragem:1, agilidade:2, engenho:2}, items:['Bússola', 'Bolsa de ferramentas'], position:{x:2,y:6} },
    },
    events: [{id:randomUUID(), at:created, kind:'master', actor:'hermes', text:'A aventura começou! ' + 'Vocês encontram uma pedra brilhante na borda da floresta. À frente há uma ponte de cipós, uma passagem entre raízes e um pequeno sinal deixado por um explorador.', roll:null, effects:[]}],
  };
}

export function rollTest(stat, dc = 11, rng = randomInt) {
  if (!['coragem','agilidade','engenho'].includes(stat)) throw new Error('Atributo inválido');
  if (![9,11,14].includes(dc)) throw new Error('Dificuldade inválida');
  const die = rng(1, 21);
  if (!Number.isInteger(die) || die < 1 || die > 20) throw new Error('Dado inválido');
  return { die, stat, dc, success: false }; // success and modifier filled by caller
}

export function actionRoll(campaign, actor, stat, dc = 11, rng = randomInt) {
  if (!campaign.players[actor]) throw new Error('Jogador inválido');
  if (stat === 'nenhum') return null;
  const roll = rollTest(stat, dc, rng);
  const modifier = campaign.players[actor].stats[stat];
  return {...roll, modifier, total:roll.die + modifier, success:roll.die + modifier >= dc};
}

export function moveToken(campaign, actor, x, y) {
  if (!campaign.players[actor]) throw new Error('Jogador inválido');
  if (!Number.isInteger(x) || !Number.isInteger(y) || !MAP[y] || MAP[y][x] !== '.') throw new Error('Casa bloqueada ou fora do mapa');
  const player = campaign.players[actor];
  const distance = Math.abs(player.position.x - x) + Math.abs(player.position.y - y);
  if (distance !== 1) throw new Error('Movimento permitido: uma casa por vez');
  if (Object.values(campaign.players).some(other => other.id !== actor && other.position.x === x && other.position.y === y)) throw new Error('Casa ocupada pelo outro jogador');
  const updated = structuredClone(campaign);
  updated.players[actor].position = {x,y};
  updated.revision++;
  updated.updatedAt = now();
  return updated;
}

export function parseMasterReply(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Resposta vazia do Hermes');
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(stripped); }
  catch {
    const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) { try { parsed = JSON.parse(fenced[1]); } catch {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // A plain-text answer is usable narrative, never a command to change game state.
    return {narration:clean(stripped, 1800), title:'', objective:'', choices:[], effects:[]};
  }
  const effects = (Array.isArray(parsed.effects) ? parsed.effects : []).slice(0, 4).map(effect => ({
    actor: clean(effect?.actor, 20),
    hpDelta: Number.isInteger(effect?.hpDelta) && Math.abs(effect.hpDelta) <= 2 ? effect.hpDelta : 0,
    addItem: clean(effect?.addItem, 50),
  }));
  return {
    narration: clean(parsed.narration, 1800),
    title: clean(parsed.title, 80),
    objective: clean(parsed.objective, 180),
    choices: choicesFrom(parsed.choices),
    effects,
  };
}

export function resolveTurn(campaign, actor, action, roll, reply) {
  if (!campaign.players[actor]) throw new Error('Jogador inválido');
  const updated = structuredClone(campaign);
  const safeNarration = reply.narration || 'O mestre observa a decisão de vocês, e a aventura continua.';
  if (reply.title) updated.scene.title = reply.title;
  if (reply.objective) updated.scene.objective = reply.objective;
  if (reply.choices.length) updated.scene.choices = reply.choices;
  updated.scene.narration = safeNarration;
  const applied = [];
  const seen = new Set();
  for (const effect of reply.effects) {
    if (!['joe','benicio'].includes(effect.actor) || seen.has(effect.actor)) continue;
    seen.add(effect.actor);
    const player = updated.players[effect.actor];
    if (effect.hpDelta) {
      const oldHp = player.hp;
      player.hp = Math.max(1, Math.min(player.maxHp, oldHp + effect.hpDelta));
      if (player.hp !== oldHp) applied.push(`${player.hero}: vida ${oldHp}→${player.hp}`);
    }
    if (effect.addItem && player.items.length < 10 && !player.items.includes(effect.addItem)) {
      player.items.push(effect.addItem);
      applied.push(`${player.hero} recebeu ${effect.addItem}`);
    }
  }
  updated.events.push({id:randomUUID(), at:now(), kind:'player', actor, text:clean(action, 280), roll, effects:[]});
  updated.events.push({id:randomUUID(), at:now(), kind:'master', actor:'hermes', text:safeNarration, roll:null, effects:applied});
  updated.events = updated.events.slice(-120);
  updated.revision++;
  updated.updatedAt = now();
  return updated;
}

export function demoMasterReply(campaign, actor, action, roll) {
  const name = campaign.players[actor].hero;
  const outcome = roll ? (roll.success ? `O teste de ${roll.stat} foi um sucesso (${roll.total} contra ${roll.dc}).` : `O teste de ${roll.stat} não alcançou a dificuldade (${roll.total} contra ${roll.dc}), mas vocês podem tentar outro caminho.`) : '';
  return {title:'Os Segredos da Floresta', objective:'Descobrir a origem da luz da torre', narration:`[DEMONSTRAÇÃO SEM HERMES] ${name} tenta: “${clean(action, 180)}”. ${outcome} Um pequeno guardião luminoso surge entre as folhas e aponta para um portão coberto de musgo. “A torre escuta as escolhas de vocês”, ele sussurra.`, choices:['Conversar com o guardião','Observar os símbolos do portão','Procurar um caminho alternativo'],effects:[]};
}
