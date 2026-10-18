# Hermes RPG — O Mistério da Torre Esquecida

**MVP funcional de RPG cooperativo familiar**, com Joe e Benício como jogadores e o Hermes Agent como mestre. Interface web para PC, tablet e celular. Um único mini PC Linux pode hospedar todos os componentes.

## O que já está implementado

- 2 fichas de personagem (Joe e Benício): atributos, vida e inventário.
- Um mapa de 12 x 8 casas, com paredes, marcos e movimento validado pelo backend.
- Diário persistente de campanha, cenas, missões e escolhas.
- Rolagens `1d20 + atributo` executadas no servidor (não pelo LLM).
- Integração HTTP com Hermes Agent via `POST /v1/chat/completions` (perfil dedicado).
- Respostas do mestre em JSON, com sanitização e limites para efeitos sobre personagens.
- Sincronização de múltiplos navegadores a cada 2,5 segundos (polling).
- Narração por síntese de voz do navegador, opcional e ativada por clique.
- Impressão das fichas e do diário pelo navegador.
- PIN de acesso familiar e PIN separado para reiniciar a campanha.
- Modo de demonstração sem Hermes; identificável em todas as respostas.
- Zero dependências externas npm. Testes unitários e de integração em Node.js.

**Limites do MVP:** não é uma implementação oficial de Mausritter; não está integrado ao PlanarAlly; não tem combate por turnos, chat de voz, backup automático, persistência multi-campanha ou WebSocket. O status online do Hermes testa apenas a saúde do gateway. A IA precisa de um provedor de modelo configurado no perfil.

## 1. Instalar o Hermes Agent (perfil isolado)

Se o Hermes já está instalado, crie um perfil de RPG (sem clonar o perfil pessoal):

```bash
hermes profile create rpg-mestre
hermes -p rpg-mestre setup
```

Edite `~/.hermes/profiles/rpg-mestre/.env` e adicione/ajuste:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8650
API_SERVER_KEY=defina-uma-chave-longa-e-aleatoria
```

O modelo/provider real é configurado durante `setup`. No perfil de RPG, **remova ferramentas perigosas e integrações privadas**:

```bash
hermes -p rpg-mestre tools
```

Desative, no mínimo, terminal/execução de comandos, acesso a arquivos pessoais, navegação, automações e conectores privados, se estiverem habilitados. Não confie apenas no prompt para isolamento. Perfis Hermes **não** são sandbox de filesystem. Um container com permissões mínimas é uma proteção adicional.

Inicie o gateway do perfil:

```bash
hermes -p rpg-mestre gateway start
```

Valide:

```bash
curl http://127.0.0.1:8650/health
curl http://127.0.0.1:8650/v1/models -H 'Authorization: Bearer defina-uma-chave-longa-e-aleatoria'
```

O ID do modelo anunciado deve ser colocado em `HERMES_MODEL` no `.env` do jogo. Na configuração dedicada típica, é `rpg-mestre`.

## 2. Iniciar o jogo diretamente no Linux (recomendado primeiro)

Requisitos: Node.js 20+.

```bash
cp .env.example .env
nano .env
```

Configuração mínima para jogo local no mini PC:

```dotenv
HOST=127.0.0.1
PORT=8787
APP_PIN=escolha-um-pin-forte
ADMIN_PIN=outro-pin-diferente
HERMES_MODE=hermes
HERMES_URL=http://127.0.0.1:8650/v1/chat/completions
HERMES_MODEL=rpg-mestre
HERMES_API_KEY=defina-uma-chave-longa-e-aleatoria
```

```bash
npm start
# ou node server.mjs
```

No navegador do mini PC: **http://127.0.0.1:8787**.

Para usar um tablet/celular na mesma rede, altere `HOST=0.0.0.0`, reinicie o jogo e abra `http://IP-DO-MINI-PC:8787`. Coloque o jogo **somente numa LAN confiável**, preferencialmente numa VLAN residencial com firewall. Não faça port forwarding para a internet, pois não há TLS nem autenticação multiusuário robusta.

Em dois dispositivos, cada um escolhe sua identidade no seletor "Estou jogando como". O estado é compartilhado. Se alguém já enviou uma ação, o segundo dispositivo verá "Mestre pensando" e aguardará a resposta (não há fila).

## 3. Usar Docker no Linux

```bash
cp .env.example .env
nano .env
# Para acessar pelos demais dispositivos da LAN:
# HOST=0.0.0.0
# DATA_DIR=./data

docker compose up -d --build
docker compose logs -f
```

Este `compose.yaml` utiliza **network_mode: host** intencionalmente no Linux para alcançar Hermes em `127.0.0.1:8650` sem expor a API de Hermes à LAN. Monta `./data` em `/app/data`. Para começar, a execução direta é mais simples caso existam problemas com permissões do volume.

## 4. Demonstrar sem Hermes

```dotenv
HERMES_MODE=demo
```

O jogo responde com uma narrativa determinística rotulada `[DEMONSTRAÇÃO SEM HERMES]`. O modo demo serve para validar UI, dados, mapa e persistência — **não** testa geração de narrativa nem o modelo de IA.

## 5. Regras simplificadas

- Atributos: Coragem, Agilidade, Engenho.
- Um teste opcional: `1d20 + modificador >= dificuldade`.
- Dificuldades: fácil `9`, normal `11`, difícil `14`.
- Falhar deve produzir complicação narrativa, não impasse permanente.
- HP inicial = 8 para ambos, mínimo 1 no MVP, máximo 8.
- O Hermes não executa dados: recebe os resultados oficiais do servidor.
- Efeitos retornados pela IA são limitados (até +/-2 HP e um item por personagem/turno), e todos os campos passam por validação. Jogadores podem narrar qualquer ação adequada à aventura.

A interface permite que o próprio jogador escolha se uma ação requer teste e sua dificuldade. Isto é **uma simplificação consciente do MVP**. Em uma versão avançada, o mestre proporá testes e o motor validará a dificuldade por um fluxo de duas fases.

## 6. Contrato da API do jogo

Todas as rotas `/api/*` exigem `x-app-pin: SEU_APP_PIN`. Não use o PIN em query string.

| Método | Rota | Corpo | Resultado |
|---|---|---|---|
| GET | `/health` | — | Liveness local (sem autenticação) |
| GET | `/api/status` | — | Modo e saúde do Hermes |
| GET | `/api/state` | — | Campanha completa, mapa e status ocupado |
| POST | `/api/action` | `{"actor":"benicio","action":"Examino a pedra","stat":"engenho","dc":11}` | Rolagem real, narrativa e atualização atômica |
| POST | `/api/move` | `{"actor":"joe","x":1,"y":5}` | Valida uma casa adjacente e persiste posição |
| POST | `/api/reset` | `{}` e header `x-admin-pin` | Reinicia campanha (irreversível) |

Se o Hermes não responder, `/api/action` retorna erro e não compromete o estado da campanha. As chamadas simultâneas ao mestre retornam HTTP 409; no MVP apenas uma ação é processada por vez. O estado é salvo em `data/campaign.json` de forma atômica via rename. Backup: faça cópia segura deste arquivo quando o servidor estiver parado.

### Exemplo de teste

```bash
curl -s http://127.0.0.1:8787/api/state -H 'x-app-pin: escolha-um-pin-forte'

curl -s http://127.0.0.1:8787/api/action \
  -H 'Content-Type: application/json' \
  -H 'x-app-pin: escolha-um-pin-forte' \
  -d '{"actor":"benicio","action":"Quero examinar a pedra brilhante","stat":"engenho","dc":11}'
```

## 7. Rodar testes

```bash
npm test
```

Os testes não precisam de um Hermes real: validam regras, mapa, efeitos, demo e contrato HTTP com um servidor Hermes simulado. A integração com sua instância de fato deverá ser verificada localmente via URL, API key e modelo compatível.

## 8. Roadmap

**V0.2:** fluxo mestre propõe teste → jogador rola → mestre narra; evento SSE ou WebSocket; editor de personagens, objetivos e inventário; campanhas múltiplas; resumo de memória quando o histórico crescer.

**V0.3:** narrador TTS local, STT opcional sob ativação manual, áudio em português e biblioteca de cenas; segurança adicional e controles de pai.

**V0.4:** adaptador PlanarAlly isolado: `RPG Bridge -> eventos estruturados -> mod cliente PlanarAlly`, integração de tokens/mapas sem usar APIs privadas. A API de mods do PlanarAlly é experimental. Não bloquear o MVP por isso.

**V1.0:** regras configuráveis (incluindo um adaptador compatível com Mausritter conforme a licença), PostgreSQL, autenticação individual, auditoria, backup, métricas e testes com jogadores.

## 9. Segurança e privacidade

- `HERMES_API_KEY` nunca é enviada ao navegador; a API Hermes pode continuar acessível apenas por loopback.
- Este app guarda personagens, ações e narrações num arquivo local. **Se o perfil Hermes usa um modelo remoto, o conteúdo enviado à IA sai da rede local para o provedor configurado**. Executar Hermes localmente não significa inferência local.
- A síntese de voz usa a API do navegador; dependendo da implementação e da voz, a síntese pode empregar serviços do fabricante do navegador/dispositivo. Para áudio estritamente local, integrar mecanismo offline posteriormente.
- O PIN do jogo fornece proteção básica contra acessos acidentais numa LAN, não substitui TLS, identidade individual, logs auditáveis e controle de acesso avançado.
- Não inclua segredos reais em tickets, prompts, repositórios públicos ou gravações de tela.
- Inicie o Hermes no perfil de jogo sem acesso a diretórios privados, sem ferramentas de terminal e sem plugins externos não essenciais.

## 10. Referências

- Hermes Agent API: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
- Hermes Agent perfis: https://hermes-agent.nousresearch.com/docs/user-guide/profiles
- Hermes Agent tools: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- PlanarAlly mods: https://www.planarally.io/docs/dm/mods/
- Mausritter licença de terceiros: https://mausritter.com/third-party-licence/

**Licença do código deste MVP:** MIT (arquivo LICENSE). Conteúdo narrativo original, sem reproduzir artes, marcas e regras protegidas de terceiros.
