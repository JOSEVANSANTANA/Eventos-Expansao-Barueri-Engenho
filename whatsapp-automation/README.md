# WhatsApp Automation (Node.js + whatsapp-web.js)

Aplicacao web **local** para: conectar o WhatsApp via QR Code, listar os grupos do numero
conectado, extrair os telefones dos participantes de um grupo e disparar uma mensagem
individual (texto + midia + audio PTT) para cada um, com **intervalo aleatorio de 5 a 10
segundos** entre os envios.

## Estrutura

```
whatsapp-automation/
├── package.json
├── server.js                  # Express + Socket.io + rotas da API
├── src/
│   ├── logger.js              # Logs unificados (terminal + frontend)
│   ├── whatsapp-service.js    # Sessao, grupos, participantes e envios
│   ├── campaign-runner.js     # Loop de disparo, delay aleatorio e erros
│   ├── contact-name.js        # Nomes dos contatos e marcadores {nome} etc.
│   ├── safety.js              # Limites, ritmo e janela de envio
│   ├── ledger.js              # Historico persistente e lista de descadastro
│   ├── message-variants.js    # Variantes e spintax
│   └── audio.js               # Conversao para OGG/Opus (mensagem de voz)
├── mac/                       # Fontes do app do macOS (.app)
│   ├── build-mac-app.sh
│   ├── bundle/                # Info.plist + launcher + icone
│   └── app.icns
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
└── uploads/                   # Arquivos temporarios (apagados apos o disparo)
```

## Instalacao

Requisitos: **Node.js 18+**.

```bash
cd whatsapp-automation
npm install
npm start
```

Abra `http://127.0.0.1:3000` no navegador.

Para o audio chegar como **mensagem de voz** (PTT) e nao como arquivo anexado, instale o
`ffmpeg` (opcional, mas recomendado):

```bash
sudo apt install ffmpeg     # Debian/Ubuntu
brew install ffmpeg         # macOS
winget install Gyan.FFmpeg  # Windows
```

## Uso

1. **Conectar WhatsApp** -> escaneie o QR Code (WhatsApp > Aparelhos conectados).
2. A lista de **grupos** carrega sozinha; clique em um grupo.
3. Os **numeros** dos participantes aparecem no painel 3.
4. Preencha o **texto** (use os marcadores abaixo para personalizar), e
   opcionalmente uma **midia** (imagem/video) e um **audio**.
5. Ajuste o intervalo (padrao 5s a 10s) e clique em **Iniciar disparo**.
6. Acompanhe "Enviado X de Y", os contadores e os logs em tempo real.

## Personalizacao por nome

Na extracao o sistema busca o nome de cada participante, na ordem: nome salvo na
**sua agenda** > nome publico do contato (*pushname*) > nome curto > nome
comercial verificado. Emojis, separadores e "nomes" que sao so o telefone sao
descartados, e `JOAO DA SILVA` / `joao da silva` viram `Joao da Silva`.

No texto da mensagem voce pode usar:

| Marcador           | Vira                                  |
| ------------------ | ------------------------------------- |
| `{primeiro_nome}`  | `Joao`                                |
| `{nome}`           | `Joao da Silva`                       |
| `{numero}`         | `+5511999999999`                      |

A caixa **Personalizar com o nome de cada contato** liga e desliga isso na hora
do envio:

- **Ligada**: quem tem nome recebe o proprio nome; quem nao tem cai no texto
  alternativo do campo abaixo.
- **Desligada**: ninguem recebe o nome — todos recebem a versao neutra. Assim um
  `{nome}` esquecido no texto nunca vaza literalmente para o destinatario.

Se o campo de texto alternativo ficar **vazio**, o marcador simplesmente some e a
pontuacao e ajustada: `Oi {primeiro_nome}, tudo bem?` vira `Oi, tudo bem?` em vez
de `Oi , tudo bem?`. Se preferir, escreva algo como `amigo(a)`.

A previa na interface mostra as duas versoes (com e sem nome) antes do disparo,
e o painel de participantes informa quantos nomes foram identificados.

Dica: marque **Modo simulacao** na primeira execucao. Ele percorre toda a lista,
valida os numeros e mostra o progresso, sem enviar nenhuma mensagem.

### Variaveis de ambiente

| Variavel      | Padrao      | Descricao                                             |
| ------------- | ----------- | ----------------------------------------------------- |
| `PORT`        | `3000`      | Porta do servidor                                     |
| `HOST`        | `127.0.0.1` | Interface de escuta                                   |
| `HEADLESS`    | `true`      | `false` abre o Chromium visivel (util para depurar)   |
| `CHROME_PATH` | -           | Caminho de um Chrome/Chromium ja instalado            |

## Problemas comuns com o Puppeteer

O `whatsapp-web.js` roda um Chromium via Puppeteer. Os erros mais frequentes:

**Linux — `error while loading shared libraries` / o navegador nao abre**

Faltam bibliotecas do sistema:

```bash
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 fonts-liberation
```

**`Failed to launch the browser process ... No usable sandbox!`**

Ja usamos `--no-sandbox` e `--disable-setuid-sandbox`. Se ainda falhar (containers/WSL),
rode com um Chrome do sistema:

```bash
CHROME_PATH=/usr/bin/google-chrome npm start
```

**Download do Chromium falhou / rede corporativa**

Instale sem baixar o navegador e aponte para um ja instalado:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm start
```

**`ProtocolError: Protocol error (Runtime.callFunctionOn): Target closed`**

O Chromium morreu, normalmente por falta de memoria compartilhada em Docker.
Suba o container com `--shm-size=1g` (a flag `--disable-dev-shm-usage` ja esta ativa).

**"Nao foi possivel listar os grupos: r" (ou outro erro de uma letra)**

Erro vindo de dentro da pagina do WhatsApp Web, ja minificado. Acontece quando o
`getChats()` do whatsapp-web.js quebra: ele monta o modelo de todas as conversas
de uma vez e, para cada grupo, chama `groupMetadata.update()` e modulos internos
do WhatsApp que mudam de nome entre versoes; um unico grupo problematico derruba
a lista inteira.

A aplicacao ja trata isso: quando a API padrao falha, ela passa a ler os grupos e
os participantes direto do WhatsApp Web, buscando so o necessario (id, nome e
participantes) com tratamento item a item. Voce vera no log:

```
A leitura padrao de conversas falhou (...). Usando leitura direta do WhatsApp Web...
```

Se ainda assim falhar, clique em **Diagnostico** (ao lado de "Atualizar lista").
Ele sonda o WhatsApp Web de dentro da pagina e escreve nos logs qual modulo
falhou, com a mensagem real em vez do `r` minificado.

Como ultimo recurso, fixe uma versao conhecida do WhatsApp Web:

```bash
WWEBJS_VERSION_URL="https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/<versao>.html" npm start
```

**Fica preso em "Sincronizando..." ou o QR nao aparece**

Apague a sessao e leia o QR de novo:

```bash
rm -rf .wwebjs_auth .wwebjs_cache
```

**macOS/Windows: antivirus ou Gatekeeper bloqueando**

Libere a pasta `node_modules/puppeteer/.local-chromium` (ou `~/.cache/puppeteer`).

## App do macOS

O `.app` e um bundle nativo: aparece no Launchpad, no Dock e no Finder com icone
proprio, e pode ser arrastado para a pasta **Aplicativos**. Ele nao e um app
Swift — por dentro, o executavel do bundle localiza o Node.js, sobe o servidor e
abre a interface no navegador padrao. Enquanto o app estiver aberto o servidor
esta no ar; **sair do app (Cmd+Q) derruba o servidor**.

Detalhes:

- O codigo e copiado para `~/Library/Application Support/WhatsApp Automation/`.
  Nada e gravado dentro do `.app`, entao a sessao do WhatsApp sobrevive a
  atualizacoes do app.
- As dependencias sao instaladas na primeira execucao (com dialogo de aviso).
- Se o Mac ja tiver Chrome, Brave, Edge ou Chromium, ele e reaproveitado e o
  download do Chromium do Puppeteer e dispensado.
- Log do launcher: `~/Library/Logs/WhatsApp Automation.log`.
- Abrir o app com o servidor ja rodando so traz a aba do navegador de volta.
  Se a versao em execucao for mais antiga que a do app, ele encerra a instancia
  antiga e sobe a nova (sem isso, o codigo novo era copiado para o disco mas o
  usuario continuava usando o servidor velho que ainda estava no ar).
- A versao em execucao aparece no cabecalho da interface, ao lado do titulo.
  E por ela que voce confirma que uma atualizacao realmente entrou.

Para reconstruir o bundle depois de mexer no codigo:

```bash
./mac/build-mac-app.sh    # gera dist/WhatsApp Automation.app e o .zip
```

Como o app nao e assinado nem notarizado pela Apple, na primeira abertura o
macOS reclama. Resolva com **clique direito no app > Abrir > Abrir**, ou:

```bash
xattr -dr com.apple.quarantine "/Applications/WhatsApp Automation.app"
```

## Estrategia anti-bloqueio

Uma restricao ("Sua conta esta restringida no momento") nao vem de um unico
gatilho. O classificador do WhatsApp combina sinais, e eles tem pesos bem
diferentes:

| Peso | Sinal | Como o app trata |
| --- | --- | --- |
| Altissimo | Bloqueios e denuncias de quem recebeu | linha de descadastro + lista de exclusao automatica |
| Alto | Volume por janela de tempo | limite diario e por hora, com historico persistente |
| Alto | Proporcao de destinatarios que nao te conhecem | painel de risco alerta acima de 70% |
| Medio | Cadencia regular demais | intervalo variavel, pausas longas e pausa entre lotes |
| Medio | Texto identico repetido | variantes e spintax |
| Medio | Mensagens fora de horario | janela de envio configuravel |
| Baixo | Conta nova ou recem-conectada | modo aquecimento |

### Os tres niveis de decisao

**1. Reduzir o dano real, nao so o sinal.** O que mais restringe conta e gente
denunciando. A linha de descadastro no fim da mensagem e a resposta automatica a
quem manda "SAIR" atacam a causa, nao o sintoma. Quem nao quer receber para de
receber, e nao denuncia.

**2. Separar os numeros.** Nunca use o numero principal (pessoal ou da empresa)
para prospeccao fria. Um chip so para captacao isola o risco: se ele for
restringido, sua operacao continua. O numero principal fica para quem ja
respondeu e virou conversa.

**3. Ter a saida oficial pronta.** Para volume comercial recorrente existe a
**WhatsApp Business Platform (Cloud API)**, da Meta. E o unico caminho sancionado
para envio em massa: mensagens de modelo aprovadas, cobranca por conversa,
opt-in obrigatorio e uma nota de qualidade que voce acompanha. Nao ha risco de
banimento por automacao porque a automacao e o produto. O custo e a
formalizacao: conta comercial verificada e templates aprovados.

Esta ferramenta **nao** e um substituto disso. Ela e apropriada para volume
baixo, listas mornas (pessoas que ja interagiram com voce) e comunicacao com
grupos dos quais voce participa. Qualquer automacao local viola os Termos do
WhatsApp: o risco residual nunca chega a zero.

### Limites padrao

| Parametro | Padrao | Por que |
| --- | --- | --- |
| Intervalo | 45s a 120s | 5-10s e ~8 msg/min: cadencia impossivel para uma pessoa |
| Por dia | 80 | com aquecimento, comeca em 20 e sobe ao longo de 2 semanas |
| Por hora | 20 | evita concentrar o volume do dia em minutos |
| Lote | 15 envios, pausa de 20-32 min | simula sessoes de trabalho, nao um fluxo continuo |
| Janela | 9h as 20h | mensagem de madrugada gera bloqueio |
| Repeticao | 7 dias | a mesma pessoa nao recebe duas vezes na semana |

Os limites valem por **conta**, nao por campanha: o historico fica em
`data/ledger.json` e sobrevive a reinicios. Se a campanha atingir o teto, ela
pausa e informa quantos ficaram de fora - retome depois, ninguem recebe duas vezes.

### Variacao de texto

Duas formas, combinaveis:

```
{Oi|Ola|Bom dia} {primeiro_nome}, {tudo bem|como vai}?
---
E ai {primeiro_nome}! {Beleza|Tudo certo} por ai?
```

`---` separa variantes completas; `{a|b|c}` sorteia dentro do texto. O exemplo
acima gera 8 mensagens diferentes. Marcadores como `{nome}` continuam
funcionando: so viram sorteio quando ha `|` dentro das chaves.

### Se a conta for restringida

1. **Pare tudo.** Nao tente reconectar nem enviar durante a restricao - insistir
   costuma estender o prazo.
2. Espere o contador zerar (normalmente 24h).
3. Ao voltar, **ative o modo aquecimento** e recomece por 20 mensagens no dia.
4. Envie primeiro para quem ja conversou com voce; deixe a lista fria para depois.
5. Se restringir uma segunda vez, o proximo passo e a Cloud API - o numero ja
   esta marcado.

## Avisos

- Automatizar disparos em massa viola os Termos de Servico do WhatsApp e pode levar ao
  **banimento do numero**. O intervalo aleatorio reduz o risco, mas nao o elimina.
- Use apenas com contatos que consentiram em receber suas mensagens.
- A sessao fica em `.wwebjs_auth/` (nao versionada). Qualquer pessoa com acesso a essa
  pasta acessa a conta conectada.
