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

Para reconstruir o bundle depois de mexer no codigo:

```bash
./mac/build-mac-app.sh    # gera dist/WhatsApp Automation.app e o .zip
```

Como o app nao e assinado nem notarizado pela Apple, na primeira abertura o
macOS reclama. Resolva com **clique direito no app > Abrir > Abrir**, ou:

```bash
xattr -dr com.apple.quarantine "/Applications/WhatsApp Automation.app"
```

## Avisos

- Automatizar disparos em massa viola os Termos de Servico do WhatsApp e pode levar ao
  **banimento do numero**. O intervalo aleatorio reduz o risco, mas nao o elimina.
- Use apenas com contatos que consentiram em receber suas mensagens.
- A sessao fica em `.wwebjs_auth/` (nao versionada). Qualquer pessoa com acesso a essa
  pasta acessa a conta conectada.
