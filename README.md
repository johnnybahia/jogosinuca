# Sinuca 3D

Sinuca brasileira em 3D com **física realista** (giro, efeito, atrito do pano, tabelas e caçapas), **jogo online** (salas por código/link, salas públicas, ranking), **offline contra o computador** (4 níveis) e **instalação no celular (PWA)**. Feito com TypeScript, Vite e Three.js. O servidor é um Cloudflare Worker com Durable Objects no plano **gratuito** — o mesmo esquema do Rami-kami — e o jogo se **atualiza dentro dele**, com botão "Atualizar", como no Rami-kami e no Kage.

## O que tem

- **Mesa, bolas, taco e lâmpada em 3D**: o taco (`taco.glb`) e a luminária (`pool_table_light…glb`) são os modelos fornecidos, otimizados; as bolas usam as texturas do pacote `pool-table-animation` (a face numerada foi duplicada para o lado oposto); a madeira e o pano vêm das texturas do mesmo pacote e o chão é o mármore `Marble014`. A mesa é montada por código (`scripts/build_table.mjs`) com **campo profissional de 9 pés (2,54 × 1,27 m)**, bolas de 57,15 mm e caçapas de boca estreita, mas com tabelas de borracha forradas de pano, caçapas furadas na madeira, losangos de madrepérola e pernas — o FBX original tinha tabelas planas, sem borracha.
- **Mesas e tacos sorteados**: a cada partida o jogo sorteia entre a mesa montada por código (madeira clássica ou mogno `Wood060`) e a **mesa do pacote** `pool-table-traditional` (escalada para o campo da física), e entre o taco clássico e o do pacote. Dá para fixar no menu (Madeira da mesa / Taco). `node scripts/build_pack.mjs` regera `table2.glb` e `cue2.glb`; o pano recolorível vale nas duas mesas.
- **Luz e acabamento**: três spots (um por abajur) com sombras, reflexos nas bolas (verniz), bloom, vinheta, sombras de contato, sala com lambri e mármore. Qualidade **automática** (Alta/Média/Baixa) que baixa sozinha se o aparelho não aguentar.
- **Física** (`shared/physics.ts`): bolas com giro 3D (topo, recuo e efeito lateral), transição deslizar → rolar, atrito de rolagem, colisão com restituição e atrito (o giro lateral gera "throw"), tabela que devolve menos energia em velocidades altas e muda o ângulo com efeito, pontas das tabelas e caçapas. **Determinística**: o mesmo tiro dá o mesmo resultado no cliente, no servidor e nos bots. Passo de tempo adaptativo (quebra completa ≈ 3 ms de CPU).
- **Modos** (`shared/rules.ts`): **Par ou Ímpar** (sinuca brasileira, a 8 por último), **Lisas × Listradas** (bola 8) e **Bola 61** (cada bola vale o número; toque sempre na menor; quem chegar a 61 vence). Falta = branca na mão para o adversário.
- **Treino livre** (mesa aberta, sem faltas, só a branca na mão se cair) e **dica de tacada** (💡 / H, só offline: mostra a mira, o efeito e a força que o Mestre escolheria).
- **Bot** (`shared/bot.ts`): Fácil, Normal, Difícil e Mestre. Usa bola fantasma (bola alvo → caçapa), escolhe as tacadas mais fáceis e, nos níveis altos, **testa as melhores na própria física** (cai? falta? como a branca fica?) com efeito de topo/recuo para posicionar.
- **Controles**: arrastar gira a mira (com ajuste fino, setas e Shift), pinça/roda = zoom, dois dedos inclinam; barra **FORÇA** (puxe para baixo e solte) ou Espaço; **EFEITO** tocando na bola branca; vista de cima (V) onde se toca onde mirar; bola na mão arrastando a branca. Funciona em toque e mouse, em paisagem e retrato.
- **Online** (igual ao Rami-kami): nome + foto, **vídeo e áudio ao vivo** entre os jogadores (WebRTC; câmera e microfone começam desligados), reações rápidas, sala por código/link ou pública, anfitrião escolhe modo/tempo/melhor de N, **bot na sala**, **mira ao vivo do adversário**, tempo por tacada (o relógio é do servidor; estourou = falta; 3 seguidas = derrota), **reconexão** no meio da partida, ranking global por pontuação (Elo) — só partidas entre duas pessoas contam.
- **Offline + atualização no jogo**: o service worker baixa o jogo na 1ª visita ("Baixando… N%" → "Pronto para jogar offline"). Versão nova aparece como **"Atualizar"** no menu e como um aviso dentro da partida; nunca troca sozinha no meio de uma tacada.

## Rodar localmente

Node 22.18+ (ou 20.19+ para só jogar).

```bash
npm install
npm run server:dev   # API + WebSocket em http://localhost:8787
npm run dev          # jogo em http://localhost:3000 (usa o servidor acima via .env.development)
npm test             # física, regras, bot, sala, robustez (fuzz)
npm run e2e:server   # com o server:dev ligado: teste de ponta a ponta (2 clientes, bot, reconexão, ranking)
```

Para testar offline/PWA: `npm run build` e abra o servidor do Worker (`npm run server:dev` serve a pasta `dist/`).

## Publicar de graça (um deploy só: jogo + servidor)

1. Crie uma conta gratuita em cloudflare.com.
2. `npx wrangler login`
3. `npm run deploy` — gera o build e publica. Ele imprime o endereço `https://sinuca3d.<sua-conta>.workers.dev`.
4. Abra no celular, entre, e use "Instalar app" (Android/Chrome) ou Compartilhar → Adicionar à Tela de Início (iPhone).

Pelo GitHub: crie os segredos `CLOUDFLARE_API_TOKEN` (modelo "Edit Cloudflare Workers") e `CLOUDFLARE_ACCOUNT_ID`; todo push na `main` testa e publica (`.github/workflows/deploy.yml`) e quem já tem o jogo vê o botão **Atualizar**. O `promote.yml` leva **todo push em `claude/**` que passar nos testes direto para a `main`** (e chama o deploy), sem PR. O `automerge.yml` liga o merge automático dos PRs (ative *Allow auto-merge* e marque o check `test` como obrigatório na regra da `main`).

### Sem conta na Cloudflare (só offline contra o computador)

O `pages.yml` publica o jogo no GitHub Pages a cada push na `main` quando a variável do repositório `ENABLE_PAGES` é `true` (Settings → Pages → Source: **GitHub Actions**). Para o online funcionar a partir de lá, defina a variável do repositório `SERVER_URL` com o endereço do Worker.

## Estrutura

```
shared/   física, mesa, regras, bot, sala, protocolo — o MESMO código roda no navegador (offline) e no servidor
client/   cena 3D (game/), telas (ui/), rede (net/), PWA (pwa.ts)
server/   Worker: GameRoom (sala autoritativa), Lobby (salas públicas), Ranking (SQLite)
scripts/  sw.template.js, geração de ícones/texturas/modelos, teste e2e
assets_src/  arquivos originais (zips, GLBs) — não vão para o deploy
public/   modelos (table/cue/lamp.glb) e texturas gerados a partir de assets_src/
```

### Gerar de novo os modelos e texturas (só ao trocar um arquivo de `assets_src/`)

```bash
npm i --no-save sharp @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22 polygon-clipping
node scripts/build_assets.mjs   # texturas, taco e luminária
node scripts/build_table.mjs    # mesa (usa as medidas de shared/table.ts)
node scripts/make_icons.mjs     # ícones do app
```

## Limites e riscos (leia antes de convidar muita gente)

- **Plano gratuito do Cloudflare**: ~100 mil requisições/dia no Worker e limites diários nos Durable Objects. Para jogo entre amigos sobra; se estourar, o online para até o dia seguinte (UTC). O servidor roda a física de cada tacada (3–15 ms de CPU; a quebra é a mais pesada) — se o plano gratuito impuser limite de CPU menor que isso na sua conta, o primeiro sintoma é tacada online sem resposta; o offline não é afetado.
- **Privacidade da sala**: o servidor mostra para os outros jogadores só um identificador público derivado do id, então ninguém consegue tomar o lugar de outro jogador conhecendo o id dele.
- **Ranking**: a identidade é um ID aleatório guardado no navegador (limpar os dados cria um jogador novo; dois amigos podem combinar partidas). Só partidas entre duas pessoas contam.
- **Não testado**: aparelhos reais (principalmente iPhone/Safari), desempenho em celulares fracos (há o ajuste automático de qualidade), o deploy na Cloudflare em si (só `wrangler dev` local) e o som (sintetizado, não foi ouvido em testes automáticos).
- A reprodução da tacada no cliente roda a mesma simulação do servidor; se algum dia houver diferença numérica entre navegadores, o estado oficial do servidor vence ao final da jogada (as bolas "pulam" para a posição correta).

### Vídeo atrás de roteadores restritivos (opcional)

Vídeo/áudio é ponto a ponto (WebRTC). Atrás de alguns roteadores/4G ele não conecta sem um servidor TURN. Crie uma chave TURN no painel Cloudflare (Realtime → TURN) e rode `npx wrangler secret put TURN_KEY_ID -c server/wrangler.toml` e `npx wrangler secret put TURN_API_TOKEN -c server/wrangler.toml`. O jogo funciona sem isso (a pessoa só fica com a foto).

## Zerar o ranking

1. Defina uma senha de administrador (uma vez): `npx wrangler secret put ADMIN_KEY -c server/wrangler.toml`
2. Para zerar: `curl -X POST -H "X-Admin-Key: SUA_SENHA" https://SEU-SITE.workers.dev/api/ranking/reset`
3. Erros do servidor: `curl -H "X-Admin-Key: SUA_SENHA" https://SEU-SITE.workers.dev/api/errors`
