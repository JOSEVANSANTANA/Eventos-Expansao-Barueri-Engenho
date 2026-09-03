/* =========================================================================
   RADAR INSTITUCIONAL - Orquestrador
   ========================================================================= */

const APP = {
  cfg: null,
  panorama: null,
  panoramaTexto: '',
  pautas: [],
  pacote: null,
  pautaAtual: null,
  catalogo: null,
  colheita: null,        // manchetes reais do coletor local
  temServidor: false
};

/* ---------- utilitarios ------------------------------------------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, tipo = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'all .2s';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

async function copiar(txt, oQue = 'Conteúdo') {
  try {
    await navigator.clipboard.writeText(txt);
    toast(`${oQue} copiado.`, 'ok', 2200);
  } catch (e) {
    // Fallback para contexto sem permissao de clipboard (file://, http)
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(`${oQue} copiado.`, 'ok', 2200); }
    catch (e2) { toast('Não consegui copiar. Selecione o texto manualmente.', 'err'); }
    ta.remove();
  }
}

/* Destaca marcacoes [ASSIM] preservando o escape de HTML. */
function realcarMarcacoes(txt) {
  return esc(txt).replace(/\[([A-ZÀ-ÚÇ\s]+)\]/g, '<span class="marca">[$1]</span>');
}

const arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);

/* =========================================================================
   ESCOLHA DE PROVEDOR
   -------------------------------------------------------------------------
   Cada trabalho pode usar uma IA diferente. Com mais de uma chave preenchida
   e "perguntar" ligado, a escolha aparece antes de rodar.
   ========================================================================= */
function escolherProvedor(titulo) {
  return new Promise((resolve) => {
    const prontos = window.IA.provedoresProntos(APP.cfg);

    if (!prontos.length) { resolve(null); return; }
    if (prontos.length === 1 || !APP.cfg.perguntarProvedor) {
      resolve(prontos.includes(APP.cfg.provedor) ? APP.cfg.provedor : prontos[0]);
      return;
    }

    const modal = $('#modalProvedor');
    $('#tituloEscolha').textContent = titulo || 'Qual IA usar agora?';
    $('#escolhaNaoPerguntar').checked = false;

    $('#escolhaLista').innerHTML = prontos.map(id => {
      const p = window.IA.PROVEDORES[id];
      const m = window.IA.modeloEscolhido(APP.cfg, id);
      const rot = (p.modelos.find(x => x.id === m) || {}).rotulo || m;
      return `<button class="escolha ${id === APP.cfg.provedor ? 'preferido' : ''}" data-prov="${esc(id)}">
        <span class="escolha-nome">${esc(p.nome)}${id === APP.cfg.provedor ? ' <b>preferido</b>' : ''}</span>
        <span class="escolha-modelo">${esc(rot)}</span>
      </button>`;
    }).join('');

    const fechar = (valor) => {
      modal.classList.remove('on');
      modal.onclick = null;
      resolve(valor);
    };

    $('#escolhaLista').querySelectorAll('.escolha').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.prov;
        if ($('#escolhaNaoPerguntar').checked) {
          APP.cfg.provedor = id;
          APP.cfg.perguntarProvedor = false;
          window.CFG.salvarCfg(APP.cfg);
        }
        fechar(id);
      };
    });
    $('#escolhaCancelar').onclick = () => fechar(null);
    modal.onclick = (e) => { if (e.target.id === 'modalProvedor') fechar(null); };
    modal.classList.add('on');
  });
}

/* =========================================================================
   NAVEGACAO
   ========================================================================= */
function irPara(tela) {
  $$('.tela').forEach(t => t.classList.remove('ativa'));
  $$('.aba').forEach(a => a.classList.remove('ativa'));
  const t = $(`#tela-${tela}`);
  const a = $(`.aba[data-tela="${tela}"]`);
  if (t) t.classList.add('ativa');
  if (a) a.classList.add('ativa');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================================
   PAINEL MACRO
   ========================================================================= */
async function carregarMacro() {
  const faixa = $('#faixaMacro');
  faixa.innerHTML = `<div class="macro"><div class="rot">Carregando</div><div class="val" style="font-size:14px;color:var(--txt-3)">Banco Central…</div></div>`;

  try {
    APP.panorama = await window.DADOS.coletarPanorama();
    APP.panoramaTexto = window.DADOS.panoramaParaTexto(APP.panorama);
    renderMacro();
    const n = Object.keys(APP.panorama.indicadores).length;
    if (APP.panorama.falhas.length) {
      toast(`${n} indicadores carregados. ${APP.panorama.falhas.length} falharam — serão omitidos, não inventados.`, 'info', 5200);
    }
  } catch (e) {
    faixa.innerHTML = `<div class="macro erro"><div class="rot">Falha</div><div class="val">Sem conexão com o Banco Central</div></div>`;
    toast('Não consegui buscar os dados do Banco Central. Verifique a conexão.', 'err');
  }
}

function renderMacro() {
  const p = APP.panorama;
  if (!p) return;
  const cartoes = [];

  const ordem = ['selic', 'cdi', 'ipca12m', 'dolar', 'euro', 'ipcaMes', 'igpm', 'poupanca',
                 'pfTotal', 'pfPessoal', 'pfCheque', 'pfPessoalMes'];
  ordem.forEach(chave => {
    const i = p.indicadores[chave];
    if (!i) return;
    const valor = i.unidade === 'R$'
      ? `R$ ${i.valor.toFixed(4).replace('.', ',')}`
      : `${String(i.valor).replace('.', ',')}${i.unidade.includes('%') ? '%' : ''}`;
    cartoes.push(`
      <div class="macro${i.grupo === 'credito' ? ' custo' : ''}">
        <div class="rot">${esc(i.rotulo)}</div>
        <div class="val">${esc(valor)}</div>
        <div class="meta">${esc(i.data)} · <a href="${esc(i.linkFonte)}" target="_blank" rel="noopener">BCB ${i.codigo}</a></div>
      </div>`);
  });

  if (p.juroReal) {
    cartoes.push(`
      <div class="macro destaque" title="${esc(p.juroReal.metodo)}">
        <div class="rot">Juro real ex-ante</div>
        <div class="val">${String(p.juroReal.valor).replace('.', ',')}%</div>
        <div class="meta">Selic ÷ IPCA esperado (Focus)</div>
      </div>`);
  }

  Object.values(p.expectativas).forEach(e => {
    cartoes.push(`
      <div class="macro">
        <div class="rot">Focus: ${esc(e.indicador)} ${esc(e.ano)}</div>
        <div class="val">${String(e.mediana).replace('.', ',')}</div>
        <div class="meta">mediana · ${esc(e.respondentes)} casas · ${esc(e.data)}</div>
      </div>`);
  });

  $('#faixaMacro').innerHTML = cartoes.join('');
}

/* =========================================================================
   VARREDURA DO DIA
   ========================================================================= */
async function rodarVarredura() {
  if (!window.IA.provedoresProntos(APP.cfg).length) {
    toast('Configure ao menos uma chave de IA: Claude, Gemini ou OpenRouter.', 'err', 6000);
    abrirConfig();
    return;
  }
  const provedor = await escolherProvedor('Qual IA vai fazer a varredura?');
  if (!provedor) return;
  if (!APP.panorama) await carregarMacro();

  const area = $('#areaPautas');
  area.innerHTML = `
    <div class="carregando-box">
      <div class="spinner"></div>
      <div class="carregando-txt" id="carregandoRadar">Varrendo o mercado…</div>
      <div class="carregando-sub">Buscando notícia das últimas 72h, cruzando com dados do Banco Central e classificando por potencial viral.</div>
      <div class="stream" id="streamRadar"></div>
    </div>`;

  const stream = $('#streamRadar');
  const colado = $('#dadosColados').value;

  // Colhe manchetes reais ANTES de falar com a IA. Isso e o que faz a
  // varredura ter noticia de verdade mesmo sem a busca paga da OpenRouter.
  let noticiasTexto = '';
  if (APP.temServidor) {
    const r0 = $('#carregandoRadar');
    if (r0) r0.textContent = 'Colhendo manchetes reais de 47 fontes (Brasil e exterior)…';
    try {
      APP.colheita = await window.DADOS.coletarNoticias();
      noticiasTexto = window.DADOS.noticiasParaTexto(APP.colheita);
      if (r0) r0.textContent = `${APP.colheita.totalManchetes} manchetes colhidas. Analisando…`;
    } catch (e) {
      toast('Não consegui colher as manchetes: ' + e.message, 'err', 6000);
    }
  }

  const jaUsados = window.CFG.lerHistorico().slice(0, 12)
    .map(h => h.tema).filter(Boolean);

  try {
    const r = await window.IA.chamarIA(APP.cfg, {
      provedor,
      esperaJSON: true,
      // A cascata pode desligar a busca no meio do caminho. Cada versão do
      // prompt carrega regras diferentes, então ela pede a certa na hora.
      mensagensPara: (comBusca) => ([{
        role: 'user',
        content: window.PROMPTS.promptRadar(APP.cfg, APP.panoramaTexto, colado, {
          semBusca: !comBusca, noticiasTexto, jaUsados
        })
      }]),
      aoTentar: ({ provedor: nome, modelo, indice, total }) => {
        stream.textContent = '';
        const r0 = $('#carregandoRadar');
        if (r0) r0.textContent = indice === 0
          ? `Analisando com ${nome} (${modelo})…`
          : `Provedor ${indice + 1} de ${total}: ${nome} (${modelo})…`;
      },
      aoReceberToken: (_, acc) => { stream.textContent = acc.slice(-1400); stream.scrollTop = stream.scrollHeight; }
    });

    const j = window.IA.extrairJSON(r.texto);
    if (!j || !Array.isArray(j.pautas) || !j.pautas.length) {
      throw new Error(`${r.provedorUsado} (${r.modeloUsado}) respondeu, mas fora do formato `
        + 'esperado. Tente de novo, ou escolha outro provedor em Configurações. '
        + 'Modelos pequenos costumam falhar neste JSON — Claude e Gemini são mais confiáveis aqui.');
    }

    APP.pautas = j.pautas;
    renderPautas(j, r.citacoes, r);
    renderTermometro('#areaTermometro', 6);
    toast(`${j.pautas.length} pautas via ${r.provedorUsado}.`, 'ok');

  } catch (e) {
    area.innerHTML = `
      <div class="aviso alerta">
        <span class="aviso-i">▲</span>
        <div><b>Falha na varredura.</b><br>${esc(e.message)}</div>
      </div>
      <div class="vazio"><button class="btn btn-ouro" onclick="rodarVarredura()">Tentar de novo</button></div>`;
  }
}

function renderPautas(j, citacoes, resultado) {
  const kb = window.KB;
  let html = '';

  // Faltar busca web muda o valor do que está na tela. Precisa ficar
  // impossível de ignorar, não escondido num rodapé.
  const comColheita = !!(APP.colheita && APP.colheita.totalManchetes);

  if (comColheita) {
    const c = APP.colheita;
    html += `<div class="aviso info"><span class="aviso-i">✓</span><div>
      <b>${c.totalManchetes} manchetes reais colhidas</b> de ${c.fontesConsultadas} fontes
      em ${new Date(c.coletadoEm).toLocaleTimeString('pt-BR')} — Google News Brasil e internacional,
      Google Trends, e veículos como Folha, G1, Estadão, InfoMoney, New York Times, CNBC, WSJ e
      Federal Reserve. As pautas abaixo saíram desse material, não da memória do modelo.
      ${resultado && resultado.buscaUsada === false
        ? '<div style="margin-top:6px;opacity:.85">A busca paga da OpenRouter não rodou, mas o coletor local cobriu o lugar dela.</div>'
        : ''}
    </div></div>`;
  } else if (resultado && resultado.buscaUsada === false) {
    // A causa depende de QUEM rodou. Mandar o usuario por saldo na OpenRouter
    // quando o trabalho saiu no Gemini e mandar consertar o que nao esta quebrado:
    // Gemini e Claude nao tem busca web nesta ferramenta, ponto. Quem busca
    // noticia aqui e o coletor local, e e ele que precisa estar de pe.
    const provedorUsado = (resultado.provedorUsado || '').toLowerCase();
    const naOpenRouter = provedorUsado === 'openrouter'
      || /openrouter|\//.test(String(resultado.modeloUsado || ''));
    const comoResolver = naOpenRouter
      ? `<div style="margin-top:8px;font-size:12.5px"><b>Para resolver:</b> ligue o coletor local —
         abra pelo atalho <b>ABRIR-WINDOWS.bat</b> ou <b>ABRIR-MAC-LINUX.command</b> e o selo do topo
         vira <i>Coletor ativo</i>. Ele lê 47 fontes e é gratuito.
         <div style="margin-top:5px;opacity:.85">A busca paga da OpenRouter é a outra via, mas
         devolve página institucional no lugar de notícia — por isso vem desligada.</div></div>`
      : `<div style="margin-top:8px;font-size:12.5px"><b>Para resolver:</b> ligue o coletor local —
         abra pelo atalho <b>ABRIR-WINDOWS.bat</b> ou <b>ABRIR-MAC-LINUX.command</b> e o selo do topo
         vira <i>Coletor ativo</i>. Ele lê 47 fontes, é gratuito, e é quem traz notícia nesta ferramenta.
         <div style="margin-top:5px;opacity:.85">Não é problema da sua chave: ${esc(resultado.modeloUsado || 'o modelo escolhido')}
         não faz busca na web por conta própria. Nenhuma configuração aqui muda isso.</div></div>`;

    html += `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>Estas pautas saíram SEM busca web e SEM coletor.</b><br>
      Foram construídas apenas com os dados do Banco Central que você vê no painel — reais e
      datados — e não com notícia das últimas 72 horas.
      <div style="margin-top:8px"><b>Na prática:</b> os ângulos são válidos e os
      números são verdadeiros, mas nada aqui é novidade do dia. Antes de gravar
      qualquer pauta que mencione fato recente, confirme na fonte.</div>
      ${comoResolver}
    </div></div>`;
  }

  if (resultado && resultado.modeloUsado) {
    const t = (resultado.tentativas || []).length;
    html += `<div class="cartao" style="margin-bottom:18px;padding:12px 16px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:12.5px">
      <span class="tag tag-mestre">${esc(resultado.modeloUsado)}</span>
      <span style="color:var(--txt-3)">busca web: <b style="color:${resultado.buscaUsada ? 'var(--verde)' : 'var(--vermelho)'}">${resultado.buscaUsada ? 'ativa' : 'inativa'}</b></span>
      ${t ? `<span style="color:var(--txt-3)">${t} tentativa(s) antes desta</span>` : ''}
    </div>`;
  }

  if (j.leituraDeCenario) {
    html += `<div class="cartao" style="margin-bottom:18px;border-left:3px solid var(--ouro)">
      <div class="rotulo">Leitura de cenário</div>
      <div style="font-size:14.5px;line-height:1.7">${esc(j.leituraDeCenario)}</div>
    </div>`;
  }

  if (arr(j.alertasDeVerificacao).length) {
    html += `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>Não foi possível confirmar:</b>
      <ul style="margin:7px 0 0 17px;font-size:12.5px">${arr(j.alertasDeVerificacao).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      <div style="margin-top:7px;font-size:12px;opacity:.85">Estes pontos ficaram de fora ou vão marcados como não verificados no roteiro. Nada foi preenchido por suposição.</div>
    </div></div>`;
  }

  html += '<div class="grade g-auto">';
  j.pautas.forEach((p, idx) => {
    const t = Number(p.temperaturaViral) || 0;
    const cls = t >= 75 ? 'q' : t >= 50 ? 'm' : 'f';
    const prod = kb.PRODUTOS.find(x => x.id === p.produtoSugerido);
    const mestre = kb.MESTRES.find(x => x.id === p.mestreSugerido);

    html += `
      <article class="pauta" data-idx="${idx}">
        <div class="pauta-topo">
          <div class="termo ${cls}" title="${String(p.origemTemperatura || '').toUpperCase().includes('MEDID') ? 'Temperatura medida pelo coletor' : 'Temperatura estimada pelo modelo'}">${t}</div>
          <div style="flex:1;min-width:0">
            <h3>${esc(p.titulo)}</h3>
            ${p.janelaDeOportunidade ? `<div class="quando">Janela: ${esc(p.janelaDeOportunidade)}</div>` : ''}
          </div>
        </div>
        ${p.oQueAconteceu ? `<div class="dor" style="margin-bottom:9px">${esc(p.oQueAconteceu)}</div>` : ''}
        <div class="angulo"><b>Ângulo contraintuitivo</b>${esc(p.anguloContraintuitivo)}</div>
        ${p.dorDoPublico ? `<div class="dor"><b style="color:var(--txt)">Dor:</b> ${esc(p.dorDoPublico)}</div>` : ''}
        <div class="pauta-rodape">
          ${prod ? `<span class="tag tag-produto">${esc(prod.nome.split('(')[0].trim())}</span>` : ''}
          ${mestre ? `<span class="tag tag-mestre">${esc(mestre.nome)}</span>` : ''}
          ${p.formatoIdeal ? `<span class="tag tag-formato">${esc(p.formatoIdeal)}</span>` : ''}
          <span class="tag tag-fonte">${arr(p.fontes).length} fonte(s)</span>
          ${String(p.origemTemperatura || '').toUpperCase().includes('MEDID')
            ? '<span class="selo-medida">temp. medida</span>'
            : '<span class="selo-estimada">temp. estimada</span>'}
        </div>
      </article>`;
  });
  html += '</div>';

  if (citacoes && citacoes.length) {
    html += `<div class="cartao" style="margin-top:20px">
      <div class="rotulo">Fontes consultadas nesta varredura (${citacoes.length})</div>
      ${citacoes.map(c => `<div class="fonte"><span class="fonte-i">↗</span><div><b>${esc(c.titulo)}</b><br><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></div></div>`).join('')}
    </div>`;
  }

  $('#areaPautas').innerHTML = html;

  $$('.pauta').forEach(el => {
    el.onclick = () => gerarPacote(APP.pautas[+el.dataset.idx]);
  });
}

/* =========================================================================
   TERMOMETRO DE VIRALIZACAO
   -------------------------------------------------------------------------
   Nota medida, nao opinada. Os cinco componentes vem do coletor:
   amplitude (em quantos veiculos bateu), velocidade (quao recente),
   volume (quantas materias), tensao (quanto atrito nas manchetes) e
   busca (volume no Google Trends).
   ========================================================================= */
function renderTermometro(alvo, limite) {
  const el = $(alvo);
  if (!el) return;
  const c = APP.colheita;

  // Colheita vazia COM servidor ligado significa que algo falhou. Mostrar
  // "nenhuma colheita" nesse caso deixa o usuário no escuro - o relatório
  // por fonte tem que aparecer.
  if (c && APP.temServidor && (!c.assuntos || !c.assuntos.length)) {
    const falhas = arr(c.relatorio).filter(r => !r.ok);
    el.innerHTML = `
      <div class="aviso alerta"><span class="aviso-i">▲</span><div>
        <b>A coleta voltou vazia.</b> ${c.fontesOk || 0} de ${c.fontesConsultadas || 0} fontes
        responderam${falhas.length ? `, ${falhas.length} falharam` : ''}.
        ${c.avisoSSL ? `<div style="margin-top:8px">${esc(c.avisoSSL)}</div>` : ''}
      </div></div>
      ${falhas.length ? `<div class="cartao"><div class="rotulo">O que falhou, fonte por fonte</div>
        ${falhas.map(f => `<div class="check nao"><span class="check-i">✕</span><div>
          <b>${esc(f.fonte)}</b><br><span style="opacity:.85;font-family:var(--mono);font-size:11.5px">${esc(f.erro)}</span>
        </div></div>`).join('')}</div>` : ''}`;
    return;
  }

  if (!c || !c.assuntos || !c.assuntos.length) {
    el.innerHTML = APP.temServidor
      ? `<div class="vazio"><div class="vazio-i">◷</div><h3>Nenhuma colheita ainda</h3>
         <p>Rode a varredura do dia ou clique em <b>Colher manchetes agora</b>. O coletor
         lê 47 fontes — Google News Brasil e internacional, Google Trends, e veículos como
         Folha, G1, Estadão, InfoMoney, New York Times, CNBC, WSJ, Investing e o Federal
         Reserve.</p></div>`
      : `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
         <b>O coletor não está disponível neste modo.</b><br>
         Você abriu o arquivo direto do disco (<code>file://</code>). Nenhum feed de notícia
         brasileiro libera acesso ao navegador, então quem busca é o servidor local.
         <div style="margin-top:8px">Para ativar: descompacte o <b>.zip</b> e abra pelo
         atalho <b>ABRIR-WINDOWS.bat</b> ou <b>ABRIR-MAC-LINUX.command</b>. É o mesmo clique
         duplo, e aí a coleta funciona.</div></div></div>`;
    return;
  }

  const nota = (t) => t >= 70 ? 'q' : t >= 45 ? 'm' : 'f';

  // O selo responde a pergunta que decide pauta: isso é novo, está subindo,
  // ou é o mesmo assunto de ontem?
  const selo = (n) => {
    if (!n) return '';
    if (n.estado === 'novo') return '<span class="selo-nov novo">novo</span>';
    if (n.estado === 'alta') return `<span class="selo-nov alta">em alta ${n.aceleracao}×</span>`;
    if (n.estado === 'recorrente') return `<span class="selo-nov recorrente">recorrente · ${n.vezes} coletas</span>`;
    return '';
  };
  const barra = (rot, val, cls) => `
    <div class="barra ${cls || ''}">
      <div class="rot"><span>${rot}</span><b>${val}</b></div>
      <div class="trilho"><div class="preench" style="width:${Math.max(2, Math.min(100, val))}%"></div></div>
    </div>`;

  const itens = c.assuntos.slice(0, limite || 22).map((a, i) => {
    const k = a.componentes || {};
    return `
    <article class="termo-item" data-assunto="${i}">
      <div class="termo-cab">
        <div class="termo-nota ${nota(a.temperatura)}"><b>${a.temperatura}</b><span>medida</span></div>
        <div class="termo-titulo">
          <h4>${esc(a.termo)} ${selo(a.novidade)}</h4>
          <div class="meta">${a.volume} matérias · ${a.veiculos} veículos ·
            ${a.recentes6h} nas últimas 6h${a.idadeMediana !== undefined
              ? ` · mediana ${a.idadeMediana}h` : ''} · ${(a.frentes || []).join(', ')}</div>
        </div>
      </div>
      <div class="barras">
        ${barra('Amplitude', k.amplitude)}
        ${barra('Velocidade', k.velocidade, 'velocidade')}
        ${barra('Volume', k.volume)}
        ${barra('Tensão', k.tensao, 'tensao')}
        ${barra('Busca', k.busca, 'busca')}
      </div>
      <div class="termo-manchetes">
        ${(a.manchetes || []).slice(0, 3).map(m => `
          <a href="${esc(m.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
            ${esc(m.titulo)}
            <span class="vei">— ${esc(m.veiculo)}${m.horas !== null ? ` · há ${m.horas}h` : ''}</span>
          </a>`).join('')}
      </div>
    </article>`;
  }).join('');

  el.innerHTML = `
    <div class="cartao" style="margin-bottom:14px;padding:13px 16px;font-size:12.5px;color:var(--txt-2)">
      <b style="color:var(--ouro)">${c.totalManchetes} manchetes financeiras</b> ·
      últimas ${c.janelaHoras || 60}h ·
      ${c.novos ? `<b style="color:var(--verde)">${c.novos} novos</b> · ` : ''}
      ${c.emAlta ? `<b style="color:var(--ouro)">${c.emAlta} em alta</b> · ` : ''}
      ${c.fontesOk || c.fontesConsultadas} de ${c.fontesConsultadas} fontes responderam ·
      ${(c.idiomas || []).join(' + ')} ·
      ${(c.frentes || []).length} frentes ·
      colhidas ${new Date(c.coletadoEm).toLocaleTimeString('pt-BR')}
      ${c.fontesFalhas ? ` · <a href="#" id="verFalhas" style="color:var(--vermelho)">${c.fontesFalhas} falharam</a>` : ''}
      ${c.avisoSSL ? `<div class="aviso alerta" style="margin-top:10px"><span class="aviso-i">▲</span><div>${esc(c.avisoSSL)}</div></div>` : ''}
      <div id="listaFalhas" style="display:none;margin-top:10px">
        ${arr(c.relatorio).filter(r => !r.ok).map(f => `<div class="check nao"><span class="check-i">✕</span><div>
          <b>${esc(f.fonte)}</b><br><span style="opacity:.85;font-family:var(--mono);font-size:11px">${esc(f.erro)}</span>
        </div></div>`).join('')}
      </div>
    </div>
    <div class="termo-lista">${itens}</div>`;

  const vf = el.querySelector('#verFalhas');
  if (vf) vf.onclick = (e) => {
    e.preventDefault();
    const l = el.querySelector('#listaFalhas');
    l.style.display = l.style.display === 'none' ? 'block' : 'none';
  };

  el.querySelectorAll('.termo-item').forEach(it => {
    it.onclick = () => {
      const a = c.assuntos[+it.dataset.assunto];
      if (!a) return;
      gerarPacote({
        titulo: a.termo,
        oQueAconteceu: (a.manchetes || []).slice(0, 3).map(m => m.titulo).join(' | '),
        anguloContraintuitivo: '',
        dorDoPublico: '',
        temperaturaViral: a.temperatura,
        fontes: (a.manchetes || []).map(m => ({ titulo: m.titulo, url: m.url, veiculo: m.veiculo }))
      });
    };
  });
}

async function colherManchetes(alvo) {
  if (!APP.temServidor) { renderTermometro(alvo); return; }
  const el = $(alvo);
  if (el) el.innerHTML = `<div class="carregando-box"><div class="spinner"></div>
    <div class="carregando-txt">Colhendo manchetes…</div>
    <div class="carregando-sub">47 fontes: Google News BR e internacional, Trends, Folha, G1, Estadão, NYT, CNBC, WSJ, Investing, Fed.</div></div>`;
  try {
    APP.colheita = await window.DADOS.coletarNoticias(90000, true);
    renderTermometro(alvo);
    renderTermometro('#areaTermometro', 6);
    const c2 = APP.colheita;
    toast(c2.totalManchetes
      ? `${c2.totalManchetes} manchetes de ${c2.fontesOk}/${c2.fontesConsultadas} fontes.`
      : `Coleta vazia — ${c2.fontesFalhas} fontes falharam. Veja o detalhe na tela.`,
      c2.totalManchetes ? 'ok' : 'err', 6000);
  } catch (e) {
    if (el) el.innerHTML = `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>Falha na coleta.</b><br>${esc(e.message)}</div></div>`;
  }
}

/* =========================================================================
   GERACAO DO PACOTE
   ========================================================================= */
async function gerarPacote(pauta, provedorEscolhido) {
  if (!pauta) return;
  const provedor = provedorEscolhido
    || await escolherProvedor('Qual IA vai escrever o pacote?');
  if (!provedor) return;
  APP.pautaAtual = pauta;
  irPara('pacote');

  $('#tituloPacote').textContent = pauta.titulo;
  $('#subPacote').textContent = 'Gerando pacote completo…';
  $('#acoesPacote').style.display = 'none';
  $('#areaPacote').innerHTML = `
    <div class="carregando-box">
      <div class="spinner"></div>
      <div class="carregando-txt" id="carregandoPacote">Escrevendo o pacote…</div>
      <div class="carregando-sub">Confirmando os fatos na web, ancorando na filosofia do mestre e montando roteiro, CTA, direção e SEO.</div>
      <div class="stream" id="streamPacote"></div>
    </div>`;

  const stream = $('#streamPacote');

  try {
    const r = await window.IA.chamarIA(APP.cfg, {
      provedor,
      esperaJSON: true,
      maxTokens: 22000,
      mensagensPara: (comBusca) => ([{
        role: 'user',
        content: window.PROMPTS.promptPacote(APP.cfg, APP.panoramaTexto, pauta, {
          formato: APP.cfg.formatoPadrao,
          produtoId: APP.cfg.produtoPreferido || pauta.produtoSugerido,
          mestreId: pauta.mestreSugerido,
          semBusca: !comBusca,
          noticiasTexto: APP.colheita ? window.DADOS.noticiasParaTexto(APP.colheita, 6) : ''
        })
      }]),
      aoTentar: ({ provedor: nome, modelo, indice, total }) => {
        stream.textContent = '';
        const r0 = $('#carregandoPacote');
        if (r0) r0.textContent = indice === 0
          ? `Escrevendo com ${nome} (${modelo})…`
          : `Provedor ${indice + 1} de ${total}: ${nome} (${modelo})…`;
      },
      aoReceberToken: (_, acc) => { stream.textContent = acc.slice(-1400); stream.scrollTop = stream.scrollHeight; }
    });

    const j = window.IA.extrairJSON(r.texto);
    if (!j) throw new Error(`${r.provedorUsado} (${r.modeloUsado}) respondeu fora do formato `
      + 'esperado. Tente de novo, ou escolha outro provedor. Claude e Gemini são mais '
      + 'confiáveis neste JSON longo do que os modelos gratuitos.');

    j._citacoes = r.citacoes || [];
    j._geradoEm = new Date().toISOString();
    j._modeloUsado = `${r.provedorUsado} · ${r.modeloUsado}`;
    j._buscaUsada = r.buscaUsada;
    APP.pacote = j;

    renderPacote(j);
    window.TP.definirRoteiros(
      j.roteiroShort && j.roteiroShort.texto,
      j.roteiroLongo && j.roteiroLongo.texto,
      {
        short: Number(j.roteiroShort && j.roteiroShort.duracaoEstimadaSeg) || 0,
        longo: (Number(j.roteiroLongo && j.roteiroLongo.duracaoEstimadaMin) || 0) * 60
      }
    );
    $('#acoesPacote').style.display = 'flex';
    toast('Pacote pronto.', 'ok');

  } catch (e) {
    $('#areaPacote').innerHTML = `
      <div class="aviso alerta"><span class="aviso-i">▲</span><div><b>Falha ao gerar.</b><br>${esc(e.message)}</div></div>
      <div class="vazio"><button class="btn btn-ouro" id="btnRetentar">Tentar de novo</button></div>`;
    const b = $('#btnRetentar');
    if (b) b.onclick = () => gerarPacote(pauta);
  }
}

/* =========================================================================
   GRAFICOS DA APRESENTACAO
   -------------------------------------------------------------------------
   SVG desenhado aqui, sem biblioteca externa: o arquivo roda em file:// e nao
   pode depender de CDN. So desenha o que tem numero de verdade - serie sem
   valor numerico e descartada antes de virar barra.
   ========================================================================= */
const CORES_GRAFICO = ['#E5B75C', '#4D8DF6', '#19C98B', '#9B7BF0', '#F0525F', '#B98F3C', '#6E7D95'];

function numeroDaSerie(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // aceita "14,00", "1.234,5", "-3,2%", "R$ 12,4 bi"
  const limpo = v.replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : null;
}

function seriesLimpas(g) {
  return arr(g && g.series)
    .map(s => ({ rotulo: String(s && s.rotulo || '').trim(), valor: numeroDaSerie(s && s.valor) }))
    .filter(s => s.valor !== null && s.rotulo);
}

/* Casas decimais sao decididas UMA vez por grafico, a partir da serie inteira.
   Sem isso a mesma escala sai com "71,0%" ao lado de "8,00%". */
function casasDaSerie(dados) {
  let casas = 0;
  dados.forEach(d => {
    const txt = String(d.valor);
    const ponto = txt.indexOf('.');
    if (ponto >= 0) casas = Math.max(casas, Math.min(2, txt.length - ponto - 1));
  });
  return casas;
}

function formatarValor(n, unidade, casas) {
  if (casas === undefined) casas = Math.abs(n) >= 100 ? 0 : (Math.abs(n) >= 10 ? 1 : 2);
  const txt = n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const u = String(unidade || '').trim();
  if (!u) return txt;
  return u.startsWith('%') ? `${txt}${u}` : `${txt} ${u}`;
}

/* As tres funcoes recebem o corpo da fonte em unidades de viewBox e derivam TODA a
   geometria dele. Sem isso a largura da coluna de rotulo e calculada para um tamanho
   e desenhada em outro - foi assim que "Financiamento imobiliario" saiu cortado
   dentro do card de slide, onde o SVG encolhe e a fonte precisa crescer. */
function svgBarras(dados, unidade, f) {
  const casas = casasDaSerie(dados);
  const corta = (t) => t.length > 30 ? t.slice(0, 29) + '…' : t;
  const rotulos = dados.map(d => corta(d.rotulo));
  const valores = dados.map(d => formatarValor(d.valor, unidade, casas));

  const larg = 620, linha = f * 2.46, topo = f * 0.5;
  const colRotulo = Math.min(larg * 0.42, Math.max(f * 8, Math.max(...rotulos.map(t => t.length)) * f * 0.546 + f));
  const colValor = Math.min(larg * 0.34, Math.max(f * 4.6, Math.max(...valores.map(t => t.length)) * f * 0.57 + f));
  const areaBarra = Math.max(f * 3, larg - colRotulo - colValor - f);

  const max = Math.max(0, ...dados.map(d => d.valor));
  const min = Math.min(0, ...dados.map(d => d.valor));
  const faixa = (max - min) || 1;
  const x0 = colRotulo + (0 - min) / faixa * areaBarra;   // posicao do zero
  const alt = dados.length * linha + topo * 2;

  const linhas = dados.map((d, i) => {
    const y = topo + i * linha;
    const larguraBarra = Math.max(f * 0.15, Math.abs(d.valor) / faixa * areaBarra);
    const x = d.valor >= 0 ? x0 : x0 - larguraBarra;
    const base = y + linha * 0.63;
    return `
      <text x="${(colRotulo - f * 0.75).toFixed(1)}" y="${base.toFixed(1)}" text-anchor="end" font-size="${f}" class="g-rot">${esc(rotulos[i])}</text>
      <rect x="${x.toFixed(1)}" y="${(y + linha * 0.22).toFixed(1)}" width="${larguraBarra.toFixed(1)}" height="${(f * 1.3).toFixed(1)}" rx="3" fill="${CORES_GRAFICO[i % CORES_GRAFICO.length]}" opacity=".88"/>
      <text x="${(x + larguraBarra + f * 0.7).toFixed(1)}" y="${base.toFixed(1)}" font-size="${f}" class="g-val">${esc(valores[i])}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${larg} ${alt.toFixed(0)}" class="grafico-svg" role="img">
    <line x1="${x0.toFixed(1)}" y1="${topo}" x2="${x0.toFixed(1)}" y2="${(alt - topo).toFixed(1)}" stroke="#33455F" stroke-width="1"/>
    ${linhas}
  </svg>`;
}

function svgLinha(dados, unidade, f) {
  const casas = casasDaSerie(dados);
  const larg = 620, alt = Math.round(190 + f * 4.6);
  const padE = f * 4.5, padD = f * 1.7, padT = f * 1.6, padB = f * 3.1;

  const max = Math.max(...dados.map(d => d.valor));
  const min = Math.min(...dados.map(d => d.valor));
  const faixa = (max - min) || Math.abs(max) || 1;
  const topoEscala = max + faixa * 0.12, baseEscala = min - faixa * 0.12;
  const escalaY = (v) => padT + (topoEscala - v) / (topoEscala - baseEscala) * (alt - padT - padB);
  const escalaX = (i) => padE + (dados.length === 1 ? (larg - padE - padD) / 2 : i * (larg - padE - padD) / (dados.length - 1));

  const pontos = dados.map((d, i) => `${escalaX(i).toFixed(1)},${escalaY(d.valor).toFixed(1)}`).join(' ');
  const grade = [0, 0.5, 1].map(fr => {
    const v = baseEscala + (topoEscala - baseEscala) * fr;
    const y = escalaY(v);
    return `<line x1="${padE.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(larg - padD).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#26344A" stroke-width="1"/>
            <text x="${(padE - f * 0.7).toFixed(1)}" y="${(y + f * 0.34).toFixed(1)}" text-anchor="end" font-size="${(f * 0.85).toFixed(1)}" class="g-eixo">${esc(formatarValor(v, '', casas))}</text>`;
  }).join('');

  const ancora = (i) => i === 0 ? 'start' : (i === dados.length - 1 ? 'end' : 'middle');

  /* Rotulos de valor colidem quando os pontos ficam proximos. Mede a faixa
     horizontal de cada um e joga para baixo do ponto o que invadiria o anterior. */
  const rotuloValor = dados.map(d => formatarValor(d.valor, unidade, casas));
  const desloca = [];
  let fimAnterior = -Infinity, baixoAnterior = false;
  dados.forEach((d, i) => {
    const larguraTxt = rotuloValor[i].length * f * 0.56;
    const x = escalaX(i);
    const ini = ancora(i) === 'start' ? x : (ancora(i) === 'end' ? x - larguraTxt : x - larguraTxt / 2);
    const colide = ini < fimAnterior + f * 0.4 && !baixoAnterior;
    desloca.push(colide);
    baixoAnterior = colide;
    fimAnterior = ini + larguraTxt;
  });

  const marcas = dados.map((d, i) => `
    <circle cx="${escalaX(i).toFixed(1)}" cy="${escalaY(d.valor).toFixed(1)}" r="${(f * 0.35).toFixed(1)}" fill="#E5B75C"/>
    <text x="${escalaX(i).toFixed(1)}" y="${(escalaY(d.valor) + (desloca[i] ? f * 1.55 : -f)).toFixed(1)}" text-anchor="${ancora(i)}" font-size="${f}" class="g-val">${esc(rotuloValor[i])}</text>
    <text x="${escalaX(i).toFixed(1)}" y="${(alt - f * 0.9).toFixed(1)}" text-anchor="${ancora(i)}" font-size="${(f * 0.85).toFixed(1)}" class="g-eixo">${esc(d.rotulo)}</text>`).join('');

  return `<svg viewBox="0 0 ${larg} ${alt}" class="grafico-svg" role="img">
    ${grade}
    <polyline points="${pontos}" fill="none" stroke="#E5B75C" stroke-width="${(f * 0.19).toFixed(1)}" stroke-linejoin="round"/>
    ${marcas}
  </svg>`;
}

function svgRosca(dados, unidade, f) {
  const casas = casasDaSerie(dados);
  const total = dados.reduce((a, d) => a + Math.abs(d.valor), 0);
  if (!total) return '';

  const larg = 620, r = f * 6.3, esp = f * 2.6, cx = r + esp / 2 + f, cy = Math.max(r + esp, f * 9.6);
  const alt = Math.round(Math.max(cy * 2, f * 3.2 + dados.length * f * 2.1));
  const circ = 2 * Math.PI * r;

  let acumulado = 0;
  const aneis = dados.map((d, i) => {
    const fatia = Math.abs(d.valor) / total;
    const el = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none"
      stroke="${CORES_GRAFICO[i % CORES_GRAFICO.length]}" stroke-width="${esp.toFixed(1)}"
      stroke-dasharray="${(fatia * circ).toFixed(2)} ${circ.toFixed(2)}"
      stroke-dashoffset="${(-acumulado * circ).toFixed(2)}"
      transform="rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
    acumulado += fatia;
    return el;
  }).join('');

  const xLeg = cx + r + esp / 2 + f * 1.6, passo = f * 2.1, y0 = (alt - dados.length * passo) / 2 + f;

  /* O valor fica encostado na direita: o rotulo precisa caber no que sobra,
     senao "Custo de captacao" e "21%" se escrevem por cima um do outro. */
  const valores = dados.map(d => formatarValor(d.valor, unidade, casas));
  const espacoRotulo = larg - f * 0.5 - (xLeg + f * 1.5) - Math.max(...valores.map(t => t.length)) * f * 0.58 - f;
  const maxCar = Math.max(6, Math.floor(espacoRotulo / (f * 0.56)));
  const rotulos = dados.map(d => d.rotulo.length > maxCar ? d.rotulo.slice(0, maxCar - 1) + '…' : d.rotulo);

  const legenda = dados.map((d, i) => `
    <rect x="${xLeg.toFixed(1)}" y="${(y0 + i * passo - f * 0.75).toFixed(1)}" width="${(f * 0.85).toFixed(1)}" height="${(f * 0.85).toFixed(1)}" rx="2" fill="${CORES_GRAFICO[i % CORES_GRAFICO.length]}"/>
    <text x="${(xLeg + f * 1.5).toFixed(1)}" y="${(y0 + i * passo).toFixed(1)}" font-size="${f}" class="g-rot">${esc(rotulos[i])}</text>
    <text x="${larg - f * 0.5}" y="${(y0 + i * passo).toFixed(1)}" text-anchor="end" font-size="${f}" class="g-val">${esc(valores[i])}</text>`).join('');

  return `<svg viewBox="0 0 ${larg} ${alt}" class="grafico-svg" role="img">${aneis}${legenda}</svg>`;
}

function renderGrafico(g, fonte) {
  const dados = seriesLimpas(g);
  if (!dados.length) return '';
  const f = fonte || 13;
  const tipo = String(g.tipo || 'barra').toLowerCase();
  const corpo = tipo.includes('linha') ? svgLinha(dados, g.unidade, f)
    : tipo.includes('rosca') || tipo.includes('pizza') ? svgRosca(dados, g.unidade, f)
      : svgBarras(dados, g.unidade, f);
  if (!corpo) return '';
  return `<figure class="grafico">
    ${g.titulo ? `<figcaption class="grafico-tit">${esc(g.titulo)}</figcaption>` : ''}
    ${corpo}
    ${g.leitura ? `<div class="grafico-leitura">${esc(g.leitura)}</div>` : ''}
    <div class="grafico-fonte">${g.fonte ? `Fonte: ${esc(g.fonte)}` : '<span style="color:var(--vermelho)">Sem fonte declarada — confira antes de usar</span>'}</div>
  </figure>`;
}

/* =========================================================================
   APRESENTACAO DE RESERVA
   -------------------------------------------------------------------------
   O modelo as vezes ignora o bloco "apresentacao" do esquema - modelo pequeno,
   resposta longa, ou simples desobediencia. Antes disso o bloco 9 sumia sem
   dizer nada, e o usuario ficava sem o que pediu. Aqui a apresentacao e montada
   a partir do que JA veio verificado no pacote: nada de numero novo, nada de
   fato novo, so reorganizacao do proprio conteudo em slides.
   ========================================================================= */
function apresentacaoDeReserva(j) {
  const ri = j.radarInstitucional || {};

  /* Corta na primeira frase de VERDADE: dividir em qualquer ponto transforma
     "A poupanca rendeu 0.6697% no mes" em "A poupanca rendeu 0". So conta como
     fim de frase o ponto seguido de espaco, ou o fim do texto. */
  const primeiraFrase = (t, max) => {
    const txt = String(t || '').trim();
    const corte = txt.split(/(?<=[.!?;])\s+/)[0].replace(/[.;]$/, '');
    return corte.length > max ? corte.slice(0, max - 1).trim() + '…' : corte;
  };
  const verificados = arr(j.checagem).filter(c =>
    String(c.status || '').toUpperCase().startsWith('VERIF'));

  const slides = [];

  slides.push({
    n: 1,
    titulo: (j.tema || 'O tema de hoje').split(/[:—-]/)[0].trim().slice(0, 60),
    bullets: arr(ri.resumo).slice(0, 3).map(t => primeiraFrase(t, 95)),
    dadoDestaque: verificados[0]
      ? { valor: (String(verificados[0].dado).match(/[\d.,]+\s*%?[^\s,;]*/) || [''])[0],
          rotulo: String(verificados[0].dado).slice(0, 70), fonte: verificados[0].onde || '' }
      : { valor: '', rotulo: '', fonte: '' },
    graficoId: '',
    notaDoApresentador: (j.roteiroShort && j.roteiroShort.gancho3s) || '',
    visual: 'abertura com o número em destaque'
  });

  if (ri.impactoNoBolso) {
    slides.push({
      n: slides.length + 1, titulo: 'Quem ganha e quem perde',
      bullets: String(ri.impactoNoBolso).split(/(?<=[.!?;])\s+/).slice(0, 3).map(t => primeiraFrase(t, 95)).filter(Boolean),
      dadoDestaque: verificados[1]
        ? { valor: (String(verificados[1].dado).match(/[\d.,]+\s*%?[^\s,;]*/) || [''])[0],
            rotulo: String(verificados[1].dado).slice(0, 70), fonte: verificados[1].onde || '' }
        : { valor: '', rotulo: '', fonte: '' },
      graficoId: '', notaDoApresentador: '', visual: 'dois lados da mesma conta'
    });
  }

  if (j.mestre && j.mestre.principioUsado) {
    slides.push({
      n: slides.length + 1, titulo: j.mestre.principioUsado.slice(0, 55),
      bullets: [primeiraFrase(j.mestre.comoAncora, 95)].filter(Boolean),
      dadoDestaque: { valor: '', rotulo: '', fonte: '' }, graficoId: '',
      notaDoApresentador: `Ancore em ${j.mestre.nome || 'um princípio clássico'}.`,
      visual: `retrato ou citação de ${j.mestre.nome || ''}`.trim()
    });
  }

  if (ri.nossoDiferencial) {
    slides.push({
      n: slides.length + 1, titulo: 'O que ninguém está dizendo',
      bullets: [primeiraFrase(ri.nossoDiferencial, 95)],
      dadoDestaque: { valor: '', rotulo: '', fonte: '' }, graficoId: '',
      notaDoApresentador: '', visual: 'você em plano médio, olhando para a câmera'
    });
  }

  slides.push({
    n: slides.length + 1,
    titulo: (j.cta && j.cta.produto) || 'O próximo passo',
    bullets: ['Diagnóstico do caso concreto', 'Simulação com números do cliente'],
    dadoDestaque: { valor: '', rotulo: '', fonte: '' }, graficoId: '',
    notaDoApresentador: (j.cta && j.cta.textoNoLongo) || '',
    visual: 'contato na tela'
  });

  /* Um grafico so pode juntar numeros da MESMA unidade. Pondo 137,3% ao ano ao
     lado de 0,07% ao mes na mesma escala, a barra do mes vira um risco e o
     grafico mente sobre a comparacao. Entao os verificados sao agrupados por
     unidade e so o maior grupo vira grafico - se nenhum tiver dois, nao ha
     grafico nenhum, que e melhor que um errado. */
  const porUnidade = {};
  verificados.forEach(c => {
    const texto = String(c.dado);
    const m = texto.match(/(-?\d{1,3}(?:[.,]\d+)?)\s*%/);
    if (!m) return;
    // O periodo pode vir como "a.a.", "ao ano", "em 12 meses", "no mes", "mensal"...
    // Sem ler isso, 0,07% no mes acaba na mesma escala de 137,3% ao ano.
    const depois = texto.slice(m.index + m[0].length).toLowerCase().replace(/[.\s]/g, '');
    const unidade = /^aa|^aoano|^anual|^em12meses|^nos?12meses|^acumulado/.test(depois) ? '% a.a.'
      : (/^am|^aom[eê]s|^nom[eê]s|^mensal|^dom[eê]s/.test(depois) ? '% a.m.' : '%');
    const rotulo = texto.slice(0, m.index).replace(/[-–—:]\s*$/, '').trim().slice(0, 28)
                || texto.replace(/[\d.,]+\s*%.*/, '').trim().slice(0, 28) || 'dado';
    (porUnidade[unidade] = porUnidade[unidade] || []).push({
      rotulo, valor: parseFloat(m[1].replace(',', '.')), fonte: c.onde || ''
    });
  });

  const melhor = Object.entries(porUnidade).sort((x, y) => y[1].length - x[1].length)[0];
  const graficos = (melhor && melhor[1].length >= 2) ? [{
    id: 'reserva1', tipo: 'barra',
    titulo: `Números verificados desta pauta (${melhor[0]})`,
    unidade: melhor[0],
    series: melhor[1].slice(0, 6).map(d => ({ rotulo: d.rotulo, valor: d.valor })),
    fonte: melhor[1].map(d => d.fonte).filter(Boolean).slice(0, 3).join(' · '),
    leitura: 'Todos com fonte na aba de checagem deste pacote.'
  }] : [];
  if (graficos.length) slides[0].graficoId = 'reserva1';

  const roteiroDoPrompt = slides.map((sl, i) =>
    `Slide ${i + 1} — ${sl.titulo}\n` +
    arr(sl.bullets).map(b => `  • ${b}`).join('\n') +
    (sl.dadoDestaque && sl.dadoDestaque.valor
      ? `\n  Número: ${sl.dadoDestaque.valor} (${sl.dadoDestaque.rotulo}) — fonte: ${sl.dadoDestaque.fonte}`
      : '')
  ).join('\n\n');

  const regra = '\n\nUse APENAS os dados acima. Não invente, não estime e não acrescente ' +
                'nenhum número que não esteja neste texto. Mantenha as fontes visíveis no rodapé de cada slide.';

  return {
    _reserva: true,
    titulo: j.tema || 'Apresentação',
    subtitulo: ri.nossoDiferencial ? String(ri.nossoDiferencial).slice(0, 120) : '',
    duracaoEstimadaMin: Math.max(5, slides.length * 2),
    usoRecomendado: 'reunião 1a1 com cliente',
    slides, graficos,
    promptCanva: `Crie uma apresentação profissional de ${slides.length} slides, tema financeiro, `
      + `visual escuro e sóbrio com destaque em dourado. Título: "${j.tema || ''}".\n\n${roteiroDoPrompt}${regra}`,
    promptGemini: `Você é designer de apresentações executivas. Monte ${slides.length} slides `
      + `sobre "${j.tema || ''}" para uma reunião com cliente de alta renda. `
      + `Conteúdo exato de cada slide:\n\n${roteiroDoPrompt}${regra}`,
    promptGPT: `Monte uma apresentação executiva de ${slides.length} slides sobre "${j.tema || ''}". `
      + `Público: investidor de alta renda. Tom analítico e direto.\n\n${roteiroDoPrompt}${regra}`,
    promptCarrossel: `Crie ${slides.length} cards quadrados para carrossel de Instagram sobre `
      + `"${j.tema || ''}". Um card por bloco, texto curto e legível no celular:\n\n${roteiroDoPrompt}${regra}`
  };
}

/* ---------- render de um bloco sanfonado --------------------------------- */
function bloco(num, titulo, corpo, aberto = true) {
  return `<section class="bloco ${aberto ? '' : 'fechado'}">
    <div class="bloco-cab"><div class="bloco-num">${num}</div><h3>${esc(titulo)}</h3><span class="seta">▼</span></div>
    <div class="bloco-corpo">${corpo}</div>
  </section>`;
}

function renderPacote(j) {
  const origem = j._modeloUsado ? ` · ${j._modeloUsado}` : '';
  $('#subPacote').textContent = `Gerado em ${new Date(j._geradoEm).toLocaleString('pt-BR')}${origem}`;
  let h = '';

  if (j._buscaUsada === false) {
    h += `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>Pacote gerado SEM busca web.</b> Os números vieram do painel do Banco Central,
      que são reais e datados, mas nenhum fato recente foi confirmado na internet.
      Trate qualquer menção a acontecimento atual como não verificada até você conferir.
    </div></div>`;
  }

  /* --- verificacao no topo: o que importa antes de gravar --- */
  const naoVerificados = arr(j.checagem).filter(c => String(c.status || '').toUpperCase().includes('NAO') || String(c.status || '').toUpperCase().includes('NÃO'));
  if (naoVerificados.length) {
    h += `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>${naoVerificados.length} dado(s) não confirmado(s) — revise antes de gravar:</b>
      <ul style="margin:7px 0 0 17px;font-size:12.5px">${naoVerificados.map(c => `<li>${esc(c.dado)} <span style="opacity:.75">— ${esc(c.onde)}</span></li>`).join('')}</ul>
    </div></div>`;
  } else if (arr(j.checagem).length) {
    h += `<div class="aviso info"><span class="aviso-i">✓</span><div><b>Todos os ${arr(j.checagem).length} dados do roteiro têm fonte.</b> Confira a aba de checagem antes de gravar.</div></div>`;
  }

  /* --- 1. Radar Institucional --- */
  const ri = j.radarInstitucional || {};
  h += bloco(1, 'Radar Institucional — Análise de Cenário', `
    ${arr(ri.resumo).length ? `<div class="campo"><div class="rotulo">Impacto real</div><ol class="lista-num">${arr(ri.resumo).map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>` : ''}
    ${ri.impactoNoBolso ? `<div class="campo"><div class="rotulo">Quem ganha, quem perde</div><div style="font-size:14px;line-height:1.7">${esc(ri.impactoNoBolso)}</div></div>` : ''}
    ${arr(ri.concorrencia).length ? `<div class="campo"><div class="rotulo">Como a concorrência abordaria</div><ul class="lista-limpa">${arr(ri.concorrencia).map(c => `<li><b style="color:var(--ouro)">${esc(c.criador)}</b><br>${esc(c.comoAbordaria)}${c.limitacao ? `<br><span style="color:var(--txt-3);font-size:12px">Limitação: ${esc(c.limitacao)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${ri.nossoDiferencial ? `<div class="campo"><div class="rotulo">Nosso diferencial</div><div class="angulo" style="margin:0">${esc(ri.nossoDiferencial)}</div></div>` : ''}
  `);

  /* --- 2. Ancoragem --- */
  if (j.mestre) {
    h += bloco(2, `Ancoragem — ${j.mestre.nome || ''}`, `
      <div class="campo"><div class="rotulo">Princípio usado</div><div style="font-size:15px;font-weight:650;color:var(--ouro)">${esc(j.mestre.principioUsado)}</div></div>
      <div class="campo"><div class="rotulo">Como ancora nesta pauta</div><div style="font-size:14px;line-height:1.7">${esc(j.mestre.comoAncora)}</div></div>
      ${j.mestre.fonteDoPrincipio ? `<div class="campo"><div class="rotulo">Origem</div><div style="font-size:12.5px;color:var(--txt-3);font-style:italic">${esc(j.mestre.fonteDoPrincipio)}</div></div>` : ''}
    `);
  }

  /* --- 3. Roteiro Short --- */
  if (j.roteiroShort && j.roteiroShort.texto) {
    const s = j.roteiroShort;
    h += bloco(3, `Roteiro Short — ${s.duracaoEstimadaSeg || '±50'}s`, `
      ${s.gancho3s ? `<div class="gancho"><div class="rotulo">Gancho — 3 primeiros segundos</div>${esc(s.gancho3s)}</div>` : ''}
      <div class="campo">
        <div class="rotulo">Texto para teleprompter
          <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.roteiroShort.texto,'Roteiro short')">Copiar</button>
          <button class="btn btn-sm btn-fantasma" onclick="window.TP.abrir('short')">Teleprompter</button>
        </div>
        <div class="roteiro">${realcarMarcacoes(s.texto)}</div>
        <div class="dica">${esc(s.palavras || '?')} palavras · leitura estimada ${esc(s.duracaoEstimadaSeg || '?')}s</div>
      </div>`);
  }

  /* --- 4. Roteiro Longo --- */
  if (j.roteiroLongo && j.roteiroLongo.texto) {
    const l = j.roteiroLongo;
    h += bloco(4, `Roteiro Longo — ${l.duracaoEstimadaMin || '±10'} min`, `
      ${l.coldOpen ? `<div class="gancho"><div class="rotulo">Cold open — 30 primeiros segundos</div>${esc(l.coldOpen)}</div>` : ''}
      ${l.loopAberto ? `<div class="campo"><div class="rotulo">Loop aberto (fecha no fim)</div><div class="angulo" style="margin:0">${esc(l.loopAberto)}</div></div>` : ''}
      <div class="campo">
        <div class="rotulo">Texto para teleprompter
          <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.roteiroLongo.texto,'Roteiro longo')">Copiar</button>
          <button class="btn btn-sm btn-fantasma" onclick="window.TP.abrir('longo')">Teleprompter</button>
        </div>
        <div class="roteiro">${realcarMarcacoes(l.texto)}</div>
        <div class="dica">${esc(l.palavras || '?')} palavras · ${esc(l.duracaoEstimadaMin || '?')} min</div>
      </div>`, false);
  }

  /* --- 5. CTA --- */
  if (j.cta) {
    const c = j.cta;
    h += bloco(5, `CTA Estratégico — ${c.produto || ''}`, `
      ${c.porQueEsseProduto ? `<div class="campo"><div class="rotulo">Lógica consultiva</div><div style="font-size:14px;line-height:1.7">${esc(c.porQueEsseProduto)}</div></div>` : ''}
      ${c.ondeEntra ? `<div class="campo"><div class="rotulo">Onde entra</div><div style="font-size:13.5px">${esc(c.ondeEntra)}</div></div>` : ''}
      ${c.textoNoShort ? `<div class="campo"><div class="rotulo">No short</div><div class="roteiro" style="font-size:14.5px;max-height:none">${realcarMarcacoes(c.textoNoShort)}</div></div>` : ''}
      ${c.textoNoLongo ? `<div class="campo"><div class="rotulo">No longo</div><div class="roteiro" style="font-size:14.5px;max-height:none">${realcarMarcacoes(c.textoNoLongo)}</div></div>` : ''}
      ${c.objecaoAntecipada ? `<div class="campo"><div class="rotulo">Objeção antecipada</div><div class="angulo" style="margin:0">${esc(c.objecaoAntecipada)}</div></div>` : ''}
    `);
  }

  /* --- 6. Audiovisual --- */
  if (j.audiovisual) {
    const a = j.audiovisual;
    h += bloco(6, 'Direção Audiovisual e Retenção', `
      ${a.formatoRecomendado ? `<div class="campo"><div class="rotulo">Formato</div><div style="font-size:14px">${esc(a.formatoRecomendado)}</div></div>` : ''}
      ${arr(a.enquadramentos).length ? `<div class="campo"><div class="rotulo">Enquadramentos</div><ul class="lista-limpa">${arr(a.enquadramentos).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${arr(a.cortesSecos).length ? `<div class="campo"><div class="rotulo">Cortes secos</div><ul class="lista-limpa">${arr(a.cortesSecos).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${arr(a.brolls).length ? `<div class="campo"><div class="rotulo">B-rolls</div><ul class="lista-limpa">${arr(a.brolls).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${arr(a.textoNaTela).length ? `<div class="campo"><div class="rotulo">Texto na tela</div><div class="chips">${arr(a.textoNaTela).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>` : ''}
      ${a.erroDeRetencaoAEvitar ? `<div class="campo"><div class="aviso alerta" style="margin:0"><span class="aviso-i">▲</span><div><b>Erro de retenção a evitar:</b> ${esc(a.erroDeRetencaoAEvitar)}</div></div></div>` : ''}
    `, false);
  }

  /* --- 7. Distribuicao / SEO --- */
  if (j.distribuicao) {
    const d = j.distribuicao;
    h += bloco(7, 'Distribuição e SEO', `
      ${arr(d.titulosYoutube).length ? `<div class="campo"><div class="rotulo">Títulos (clique para copiar)</div><ul class="lista-limpa">${arr(d.titulosYoutube).map(t => `<li style="cursor:pointer" onclick="copiar(this.textContent.trim(),'Título')">${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${d.legendaInstagramTikTok ? `<div class="campo"><div class="rotulo">Legenda Instagram / TikTok <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.distribuicao.legendaInstagramTikTok,'Legenda')">Copiar</button></div><div class="roteiro" style="font-size:14px;max-height:300px">${esc(d.legendaInstagramTikTok)}</div></div>` : ''}
      ${d.descricaoYoutube ? `<div class="campo"><div class="rotulo">Descrição YouTube <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.distribuicao.descricaoYoutube,'Descrição')">Copiar</button></div><div class="roteiro" style="font-size:13.5px;max-height:250px">${esc(d.descricaoYoutube)}</div></div>` : ''}
      ${arr(d.capitulos).length ? `<div class="campo"><div class="rotulo">Capítulos</div><ul class="lista-limpa">${arr(d.capitulos).map(c => `<li style="font-family:var(--mono);font-size:12.5px">${esc(c)}</li>`).join('')}</ul></div>` : ''}
      ${arr(d.hashtags).length ? `<div class="campo"><div class="rotulo">Hashtags <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.distribuicao.hashtags.join(' '),'Hashtags')">Copiar</button></div><div class="chips">${arr(d.hashtags).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>` : ''}
      ${arr(d.tagsOcultasYoutube).length ? `<div class="campo"><div class="rotulo">Tags do YouTube <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.distribuicao.tagsOcultasYoutube.join(', '),'Tags')">Copiar</button></div><div class="chips">${arr(d.tagsOcultasYoutube).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
        <div class="dica">Tags não aparecem para o espectador, mas contam para a busca. Use as que descrevem o vídeo de verdade — encher de termo sem relação é penalizado pelo YouTube e derruba a entrega.</div></div>` : ''}
      ${arr(d.palavrasChaveCaudaLonga).length ? `<div class="campo"><div class="rotulo">Cauda longa</div><div class="chips">${arr(d.palavrasChaveCaudaLonga).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>` : ''}
      ${d.melhorHorarioPostagem ? `<div class="campo"><div class="rotulo">Melhor horário</div><div style="font-size:13.5px">${esc(d.melhorHorarioPostagem)}</div></div>` : ''}
    `, false);
  }

  /* --- 8. Thumbnail --- */
  if (j.thumbnail) {
    const t = j.thumbnail;
    h += bloco(8, 'Máquina de Thumbnails', `
      ${t.promptEN ? `<div class="campo"><div class="rotulo">Prompt para Midjourney / DALL·E <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.thumbnail.promptEN,'Prompt')">Copiar</button></div><div class="prompt-en">${esc(t.promptEN)}</div></div>` : ''}
      ${t.textoNaCapa ? `<div class="campo"><div class="rotulo">Texto na capa</div><div style="font-size:26px;font-weight:800;letter-spacing:-.8px;color:var(--ouro)">${esc(t.textoNaCapa)}</div></div>` : ''}
      <div class="linha-form duas" style="margin:0">
        ${t.paleta ? `<div><div class="rotulo">Paleta</div><div style="font-size:13.5px">${esc(t.paleta)}</div></div>` : ''}
        ${t.expressaoFacial ? `<div><div class="rotulo">Expressão facial</div><div style="font-size:13.5px">${esc(t.expressaoFacial)}</div></div>` : ''}
      </div>
    `, false);
  }

  /* --- 9. Apresentacao, slides e graficos --- */
  // Se o modelo nao devolveu a apresentacao, monta uma a partir do proprio
  // pacote em vez de esconder o bloco. O usuario pediu isso em todo pacote.
  if (!j.apresentacao || !arr(j.apresentacao.slides).length) {
    try {
      const veio = j.apresentacao || {};
      const nova = apresentacaoDeReserva(j);
      // O modelo pode ter mandado grafico ou prompt sem mandar slide. Descartar
      // isso ao montar a reserva seria jogar fora trabalho que ele ja fez certo.
      if (arr(veio.graficos).length) nova.graficos = arr(veio.graficos).concat(nova.graficos);
      ['titulo', 'subtitulo', 'usoRecomendado', 'duracaoEstimadaMin',
       'promptCanva', 'promptGemini', 'promptGPT', 'promptCarrossel']
        .forEach(k => { if (veio[k]) nova[k] = veio[k]; });
      j.apresentacao = nova;
    } catch (e) { /* pacote muito incompleto: segue sem o bloco */ }
  }
  const ap = j.apresentacao;
  if (ap && (arr(ap.slides).length || arr(ap.graficos).length || ap.promptCanva || ap.promptGemini || ap.promptGPT)) {
    const slides = arr(ap.slides);
    const graficos = arr(ap.graficos);
    const porId = {};
    graficos.forEach(g => { if (g && g.id) porId[g.id] = g; });
    const usados = new Set();

    const cartoes = slides.map((sl, i) => {
      const g = sl.graficoId && porId[sl.graficoId];
      if (g) usados.add(sl.graficoId);
      const dd = sl.dadoDestaque || {};
      return `<article class="slide">
        <div class="slide-n">${esc(sl.n || i + 1)}</div>
        <h4>${esc(sl.titulo)}</h4>
        ${arr(sl.bullets).length ? `<ul>${arr(sl.bullets).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        ${dd.valor ? `<div class="slide-dado"><b>${esc(dd.valor)}</b><span>${esc(dd.rotulo)}</span>${dd.fonte ? `<cite>${esc(dd.fonte)}</cite>` : ''}</div>` : ''}
        ${g ? renderGrafico(g, 21) : ''}
        ${sl.visual ? `<div class="slide-visual">Visual: ${esc(sl.visual)}</div>` : ''}
        ${sl.notaDoApresentador ? `<div class="slide-nota"><span>Você fala</span>${esc(sl.notaDoApresentador)}</div>` : ''}
      </article>`;
    }).join('');

    const soltos = graficos.filter(g => g && !usados.has(g.id)).map(renderGrafico).join('');

    const promptBox = (rotulo, campo, dica) => {
      const txt = ap[campo];
      if (!txt) return '';
      return `<div class="campo">
        <div class="rotulo">${esc(rotulo)}
          <button class="btn btn-sm btn-fantasma" onclick="copiar(APP.pacote.apresentacao.${campo},'${esc(rotulo)}')">Copiar</button>
        </div>
        <div class="prompt-en" style="font-family:inherit;font-size:13px">${esc(txt)}</div>
        ${dica ? `<div class="dica">${esc(dica)}</div>` : ''}
      </div>`;
    };

    h += bloco(9, `Apresentação — ${slides.length || '?'} slides`, `
      ${ap._reserva ? `<div class="aviso info" style="margin:0 0 15px"><span class="aviso-i">i</span><div>
        <b>Apresentação montada aqui, a partir do próprio pacote.</b> O modelo não devolveu o
        bloco desta vez, então os slides foram remontados com os dados que já estavam
        verificados acima — nenhum número novo entrou. Gerando de novo, costuma vir do modelo
        com mais acabamento.</div></div>` : ''}
      ${ap.titulo ? `<div class="campo"><div class="rotulo">Título</div><div style="font-size:19px;font-weight:750;letter-spacing:-.4px;color:var(--ouro)">${esc(ap.titulo)}</div>${ap.subtitulo ? `<div style="font-size:13.5px;color:var(--txt-2);margin-top:4px">${esc(ap.subtitulo)}</div>` : ''}</div>` : ''}
      ${(ap.usoRecomendado || ap.duracaoEstimadaMin) ? `<div class="dica" style="margin:-8px 0 15px">${esc(ap.usoRecomendado || '')}${ap.duracaoEstimadaMin ? ` · ${esc(ap.duracaoEstimadaMin)} min de apresentação` : ''}</div>` : ''}
      ${cartoes ? `<div class="campo"><div class="rotulo">Roteiro visual — slide a slide
        <button class="btn btn-sm btn-fantasma" onclick="baixarSlides(APP.pacote)">Baixar deck .html</button>
      </div><div class="slides">${cartoes}</div></div>` : ''}
      ${soltos ? `<div class="campo"><div class="rotulo">Gráficos avulsos</div>${soltos}</div>` : ''}
      ${promptBox('Prompt para o Canva (Magic Design)', 'promptCanva', 'Cole no campo de texto do Canva em Apresentação > Magic Design, ou em Docs to Deck.')}
      ${promptBox('Prompt para o Gemini', 'promptGemini', 'O prompt já carrega os números e as fontes dentro dele — a IA que receber não precisa buscar nada.')}
      ${promptBox('Prompt para o ChatGPT / GPT', 'promptGPT', '')}
      ${promptBox('Prompt para carrossel de Instagram', 'promptCarrossel', '')}
      <div class="dica">O deck .html abre no navegador, avança com as setas e imprime em PDF (Ctrl+P) — serve para apresentar sem depender de ferramenta nenhuma.</div>
    `, false);
  }

  /* --- 10. Fontes e checagem --- */
  const temFontes = arr(j.fontes).length || arr(j._citacoes).length || arr(j.checagem).length;
  if (temFontes) {
    h += bloco(10, 'Fontes e Checagem', `
      ${arr(j.checagem).length ? `<div class="campo"><div class="rotulo">Checagem dado a dado</div>${arr(j.checagem).map(c => {
        const nao = String(c.status || '').toUpperCase().includes('NAO') || String(c.status || '').toUpperCase().includes('NÃO');
        return `<div class="check ${nao ? 'nao' : 'ok'}"><span class="check-i">${nao ? '✕' : '✓'}</span><div><b>${esc(c.dado)}</b><br><span style="opacity:.85">${esc(c.onde)}</span></div></div>`;
      }).join('')}</div>` : ''}
      ${arr(j.fontes).length ? `<div class="campo"><div class="rotulo">Fontes das afirmações</div>${arr(j.fontes).map(f => `<div class="fonte"><span class="fonte-i">↗</span><div><b>${esc(f.afirmacao)}</b><br>${esc(f.veiculo)} ${f.data ? `· ${esc(f.data)}` : ''}<br>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a>` : '<span style="color:var(--vermelho)">sem URL</span>'}</div></div>`).join('')}</div>` : ''}
      ${arr(j._citacoes).length ? `<div class="campo"><div class="rotulo">Páginas lidas pela busca (${j._citacoes.length})</div>${j._citacoes.map(c => `<div class="fonte"><span class="fonte-i">↗</span><div><b>${esc(c.titulo)}</b><br><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></div></div>`).join('')}</div>` : ''}
    `, false);
  }

  h += `<div class="aviso legal"><span class="aviso-i">§</span><div>${esc(window.KB.COMPLIANCE.disclaimerLongo)}</div></div>`;

  $('#areaPacote').innerHTML = h;

  $$('.bloco-cab').forEach(cab => {
    cab.onclick = () => cab.parentElement.classList.toggle('fechado');
  });
}

/* =========================================================================
   EXPORTACAO
   ========================================================================= */
function pacoteParaMarkdown(j) {
  if (!j) return '';
  const L = [];
  const secao = (t) => L.push(`\n## ${t}\n`);

  L.push(`# ${j.tema || 'Pacote de Conteúdo'}`);
  L.push(`\n_Gerado em ${new Date(j._geradoEm).toLocaleString('pt-BR')} — Radar Institucional_\n`);

  const ri = j.radarInstitucional || {};
  secao('1. Radar Institucional');
  arr(ri.resumo).forEach((l, i) => L.push(`${i + 1}. ${l}`));
  if (ri.impactoNoBolso) L.push(`\n**Quem ganha, quem perde:** ${ri.impactoNoBolso}`);
  if (arr(ri.concorrencia).length) {
    L.push('\n**Concorrência:**');
    arr(ri.concorrencia).forEach(c => L.push(`- **${c.criador}**: ${c.comoAbordaria}${c.limitacao ? ` _(limitação: ${c.limitacao})_` : ''}`));
  }
  if (ri.nossoDiferencial) L.push(`\n**Nosso diferencial:** ${ri.nossoDiferencial}`);

  if (j.mestre) {
    secao(`2. Ancoragem — ${j.mestre.nome}`);
    L.push(`**Princípio:** ${j.mestre.principioUsado}`);
    L.push(`\n${j.mestre.comoAncora}`);
    if (j.mestre.fonteDoPrincipio) L.push(`\n_Fonte: ${j.mestre.fonteDoPrincipio}_`);
  }

  if (j.roteiroShort && j.roteiroShort.texto) {
    secao('3. Roteiro Short');
    if (j.roteiroShort.gancho3s) L.push(`**Gancho (3s):** ${j.roteiroShort.gancho3s}\n`);
    L.push(j.roteiroShort.texto);
  }

  if (j.roteiroLongo && j.roteiroLongo.texto) {
    secao('4. Roteiro Longo');
    if (j.roteiroLongo.coldOpen) L.push(`**Cold open:** ${j.roteiroLongo.coldOpen}\n`);
    if (j.roteiroLongo.loopAberto) L.push(`**Loop aberto:** ${j.roteiroLongo.loopAberto}\n`);
    L.push(j.roteiroLongo.texto);
  }

  if (j.cta) {
    secao(`5. CTA — ${j.cta.produto || ''}`);
    if (j.cta.porQueEsseProduto) L.push(j.cta.porQueEsseProduto);
    if (j.cta.textoNoShort) L.push(`\n**No short:** ${j.cta.textoNoShort}`);
    if (j.cta.textoNoLongo) L.push(`\n**No longo:** ${j.cta.textoNoLongo}`);
    if (j.cta.objecaoAntecipada) L.push(`\n**Objeção antecipada:** ${j.cta.objecaoAntecipada}`);
  }

  if (j.audiovisual) {
    secao('6. Direção Audiovisual');
    const a = j.audiovisual;
    if (a.formatoRecomendado) L.push(`**Formato:** ${a.formatoRecomendado}\n`);
    [['Enquadramentos', a.enquadramentos], ['Cortes secos', a.cortesSecos], ['B-rolls', a.brolls], ['Texto na tela', a.textoNaTela]]
      .forEach(([t, v]) => { if (arr(v).length) { L.push(`\n**${t}:**`); arr(v).forEach(x => L.push(`- ${x}`)); } });
    if (a.erroDeRetencaoAEvitar) L.push(`\n**Evitar:** ${a.erroDeRetencaoAEvitar}`);
  }

  if (j.distribuicao) {
    secao('7. Distribuição e SEO');
    const d = j.distribuicao;
    if (arr(d.titulosYoutube).length) { L.push('**Títulos:**'); arr(d.titulosYoutube).forEach(t => L.push(`- ${t}`)); }
    if (d.legendaInstagramTikTok) L.push(`\n**Legenda:**\n\n${d.legendaInstagramTikTok}`);
    if (d.descricaoYoutube) L.push(`\n**Descrição YouTube:**\n\n${d.descricaoYoutube}`);
    if (arr(d.capitulos).length) { L.push('\n**Capítulos:**'); arr(d.capitulos).forEach(c => L.push(`- ${c}`)); }
    if (arr(d.hashtags).length) L.push(`\n**Hashtags:** ${arr(d.hashtags).join(' ')}`);
    if (arr(d.tagsOcultasYoutube).length) L.push(`\n**Tags YouTube:** ${arr(d.tagsOcultasYoutube).join(', ')}`);
    if (arr(d.palavrasChaveCaudaLonga).length) L.push(`\n**Cauda longa:** ${arr(d.palavrasChaveCaudaLonga).join(' | ')}`);
  }

  if (j.thumbnail) {
    secao('8. Thumbnail');
    if (j.thumbnail.promptEN) L.push('```\n' + j.thumbnail.promptEN + '\n```');
    if (j.thumbnail.textoNaCapa) L.push(`\n**Texto na capa:** ${j.thumbnail.textoNaCapa}`);
  }

  const ap = j.apresentacao;
  if (ap && (arr(ap.slides).length || arr(ap.graficos).length || ap.promptCanva || ap.promptGemini || ap.promptGPT)) {
    secao('9. Apresentação');
    if (ap.titulo) L.push(`**${ap.titulo}**${ap.subtitulo ? ` — ${ap.subtitulo}` : ''}`);
    if (ap.usoRecomendado) L.push(`\n_${ap.usoRecomendado}${ap.duracaoEstimadaMin ? ` · ${ap.duracaoEstimadaMin} min` : ''}_`);

    const porId = {};
    arr(ap.graficos).forEach(g => { if (g && g.id) porId[g.id] = g; });

    arr(ap.slides).forEach((sl, i) => {
      L.push(`\n### Slide ${sl.n || i + 1} — ${sl.titulo || ''}`);
      arr(sl.bullets).forEach(b => L.push(`- ${b}`));
      const dd = sl.dadoDestaque || {};
      if (dd.valor) L.push(`\n> **${dd.valor}** ${dd.rotulo || ''}${dd.fonte ? `  \n> _${dd.fonte}_` : ''}`);
      const g = sl.graficoId && porId[sl.graficoId];
      if (g) L.push(`\n${graficoParaMarkdown(g)}`);
      if (sl.visual) L.push(`\n_Visual: ${sl.visual}_`);
      if (sl.notaDoApresentador) L.push(`\n**Você fala:** ${sl.notaDoApresentador}`);
    });

    const usados = new Set(arr(ap.slides).map(sl => sl.graficoId).filter(Boolean));
    const soltos = arr(ap.graficos).filter(g => g && !usados.has(g.id));
    if (soltos.length) {
      L.push('\n**Gráficos avulsos:**');
      soltos.forEach(g => L.push(`\n${graficoParaMarkdown(g)}`));
    }

    [['Prompt — Canva', ap.promptCanva], ['Prompt — Gemini', ap.promptGemini],
     ['Prompt — ChatGPT', ap.promptGPT], ['Prompt — Carrossel Instagram', ap.promptCarrossel]]
      .forEach(([t, v]) => { if (v) L.push(`\n**${t}:**\n\n\`\`\`\n${v}\n\`\`\``); });
  }

  if (arr(j.checagem).length) {
    secao('10. Checagem');
    arr(j.checagem).forEach(c => L.push(`- [${String(c.status).toUpperCase().includes('NA') || String(c.status).toUpperCase().includes('NÃ') ? ' ' : 'x'}] **${c.dado}** — ${c.onde}`));
  }
  if (arr(j.fontes).length) {
    L.push('\n**Fontes:**');
    arr(j.fontes).forEach(f => L.push(`- ${f.afirmacao} — ${f.veiculo} ${f.data || ''} ${f.url || ''}`));
  }

  L.push(`\n---\n\n_${window.KB.COMPLIANCE.disclaimerLongo}_`);
  return L.join('\n');
}

/* Grafico em tabela: markdown nao desenha, mas os numeros e a fonte tem que viajar. */
function graficoParaMarkdown(g) {
  const dados = seriesLimpas(g);
  if (!dados.length) return '';
  const L = [];
  if (g.titulo) L.push(`**${g.titulo}**\n`);
  L.push(`| ${' '.repeat(0)}Item | Valor |`);
  L.push('| --- | ---: |');
  const casas = casasDaSerie(dados);
  dados.forEach(d => L.push(`| ${d.rotulo} | ${formatarValor(d.valor, g.unidade, casas)} |`));
  if (g.leitura) L.push(`\n${g.leitura}`);
  L.push(`\n_Fonte: ${g.fonte || 'NAO DECLARADA — confira antes de usar'}_`);
  return L.join('\n');
}

/* =========================================================================
   DECK .HTML AUTONOMO
   -------------------------------------------------------------------------
   Um arquivo so, sem CDN, que abre no navegador, anda com as setas e imprime
   em PDF. Serve para apresentar sem depender de Canva, Google ou internet.
   ========================================================================= */
function baixarSlides(j) {
  const ap = j && j.apresentacao;
  if (!ap || !arr(ap.slides).length) { toast('Este pacote não tem slides.', 'err'); return; }

  const porId = {};
  arr(ap.graficos).forEach(g => { if (g && g.id) porId[g.id] = g; });

  const capa = `<section class="s capa">
    <div class="marca">${esc(window.CFG.lerCfg().marca || 'Radar Institucional')}</div>
    <h1>${esc(ap.titulo || j.tema || 'Apresentação')}</h1>
    ${ap.subtitulo ? `<p class="sub">${esc(ap.subtitulo)}</p>` : ''}
    <div class="rodape">${new Date(j._geradoEm || Date.now()).toLocaleDateString('pt-BR')}</div>
  </section>`;

  const corpo = arr(ap.slides).map((sl, i) => {
    const g = sl.graficoId && porId[sl.graficoId];
    const dd = sl.dadoDestaque || {};
    return `<section class="s">
      <h2>${esc(sl.titulo)}</h2>
      ${arr(sl.bullets).length ? `<ul>${arr(sl.bullets).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${dd.valor ? `<div class="dado"><b>${esc(dd.valor)}</b><span>${esc(dd.rotulo)}</span>${dd.fonte ? `<cite>${esc(dd.fonte)}</cite>` : ''}</div>` : ''}
      ${g ? renderGrafico(g) : ''}
      ${sl.notaDoApresentador ? `<aside class="nota">${esc(sl.notaDoApresentador)}</aside>` : ''}
    </section>`;
  }).join('');

  const fecho = `<section class="s capa">
    <h1 style="font-size:34px">${esc((j.cta && j.cta.produto) || 'Vamos conversar')}</h1>
    ${j.cta && j.cta.textoNoLongo ? `<p class="sub">${esc(j.cta.textoNoLongo)}</p>` : ''}
    <div class="legal">${esc(window.KB.COMPLIANCE.disclaimerLongo)}</div>
  </section>`;

  const doc = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ap.titulo || j.tema || 'Apresentação')}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080B11;color:#E9EEF7;font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden}
.s{display:none;width:100vw;height:100vh;padding:7vh 9vw;flex-direction:column;justify-content:center;position:relative;
   background:radial-gradient(900px 520px at 84% -10%,rgba(229,183,92,.09),transparent 62%),#080B11}
.s.on{display:flex}
.capa{align-items:flex-start}
.marca{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#E5B75C;margin-bottom:22px}
h1{font-size:clamp(30px,5.4vw,62px);line-height:1.08;letter-spacing:-1.6px;font-weight:800;max-width:16ch}
h2{font-size:clamp(24px,3.6vw,42px);line-height:1.15;letter-spacing:-1px;font-weight:750;margin-bottom:26px;max-width:20ch}
.sub{margin-top:20px;font-size:clamp(15px,1.7vw,21px);color:#A9B6CA;max-width:44ch;line-height:1.55}
ul{list-style:none;display:flex;flex-direction:column;gap:15px;max-width:40ch}
li{font-size:clamp(15px,1.9vw,23px);line-height:1.45;color:#E9EEF7;padding-left:24px;position:relative}
li::before{content:'';position:absolute;left:0;top:.62em;width:9px;height:9px;border-radius:2px;background:#E5B75C}
.dado{margin-top:30px;border-left:3px solid #E5B75C;padding-left:20px}
.dado b{display:block;font-size:clamp(34px,5vw,58px);font-weight:800;letter-spacing:-2px;color:#E5B75C;line-height:1}
.dado span{display:block;font-size:15px;color:#A9B6CA;margin-top:6px}
.dado cite{display:block;font-size:11.5px;color:#6E7D95;font-style:normal;margin-top:7px}
.grafico{margin-top:26px;max-width:760px}
.grafico-tit{font-size:13px;text-transform:uppercase;letter-spacing:1.3px;color:#A9B6CA;margin-bottom:9px}
.grafico-svg{width:100%;height:auto;max-height:42vh}
.g-rot{fill:#A9B6CA;font-family:inherit}
.g-val{fill:#E9EEF7;font-weight:650;font-family:inherit}
.g-eixo{fill:#6E7D95;font-family:inherit}
.grafico-leitura{font-size:14px;color:#E9EEF7;margin-top:10px;line-height:1.5}
.grafico-fonte{font-size:11px;color:#6E7D95;margin-top:6px}
.nota{display:none;position:absolute;left:9vw;right:9vw;bottom:5vh;font-size:13px;color:#6E7D95;border-top:1px solid #26344A;padding-top:11px;line-height:1.5}
.rodape,.legal{position:absolute;left:9vw;bottom:5vh;font-size:12px;color:#6E7D95}
.legal{right:9vw;line-height:1.5;max-width:none}
.barra{position:fixed;bottom:16px;right:20px;display:flex;gap:8px;align-items:center;font-size:12px;color:#6E7D95;z-index:9}
.barra button{background:#182231;color:#E9EEF7;border:1px solid #33455F;border-radius:8px;padding:6px 13px;cursor:pointer;font-size:13px}
.barra button:hover{border-color:#E5B75C;color:#E5B75C}
body.notas .nota{display:block}
@media print{
  body{overflow:visible;background:#fff}
  .s{display:flex!important;page-break-after:always;height:auto;min-height:96vh;background:#080B11;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .barra{display:none}
}
</style></head><body>
${capa}${corpo}${fecho}
<div class="barra"><button data-ir="-1">◀</button><span id="pos"></span><button data-ir="1">▶</button><button id="bNotas">Notas</button><button onclick="print()">PDF</button></div>
<script>
var slides = document.querySelectorAll('.s'), i = 0;
function mostrar(n){ i = Math.max(0, Math.min(slides.length-1, n));
  slides.forEach(function(s,k){ s.classList.toggle('on', k===i); });
  document.getElementById('pos').textContent = (i+1)+' / '+slides.length;
  location.hash = i+1; }
document.querySelectorAll('[data-ir]').forEach(function(b){
  b.onclick = function(){ mostrar(i + Number(b.dataset.ir)); }; });
function notas(){ document.body.classList.toggle('notas'); }
document.getElementById('bNotas').onclick = notas;
document.addEventListener('keydown', function(e){
  if (e.key==='n'||e.key==='N') notas();
  if (e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ') { e.preventDefault(); mostrar(i+1); }
  if (e.key==='ArrowLeft'||e.key==='PageUp') { e.preventDefault(); mostrar(i-1); }
  if (e.key==='Home') mostrar(0);
  if (e.key==='End') mostrar(slides.length-1); });
mostrar(Math.max(0, (parseInt(location.hash.slice(1),10)||1) - 1));
<\/script></body></html>`;

  const base = nomeArquivo(j).replace(/\.md$/, '');
  baixar(`${base}-slides.html`, doc, 'text/html');
  toast('Deck baixado. Abra no navegador e ande com as setas.', 'ok');
}

function baixar(nome, conteudo, tipo = 'text/markdown') {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function nomeArquivo(j) {
  const base = (j.tema || 'pacote').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
  return `${new Date().toISOString().slice(0, 10)}-${base || 'pacote'}.md`;
}

/* =========================================================================
   TELAS ESTATICAS
   ========================================================================= */
function renderMestres() {
  $('#gradeMestres').innerHTML = window.KB.MESTRES.map(m => `
    <article class="perfil">
      <h3>${esc(m.nome)}</h3>
      <div class="sub">${esc(m.titulo)} · ${esc(m.vida)}</div>
      <div class="origem">${esc(m.origem)}</div>
      ${m.principios.map(p => `<div class="princ"><b>${esc(p.nome)}</b><p>${esc(p.essencia)}</p><cite>${esc(p.fonte)}</cite></div>`).join('')}
      <div class="angulo" style="margin-bottom:0"><b>Gancho pronto</b>${esc(m.ganchoViral)}</div>
      ${m.alerta ? `<div class="aviso alerta" style="margin:11px 0 0"><span class="aviso-i">▲</span><div>${esc(m.alerta)}</div></div>` : ''}
      ${m.checarAoVivo ? `<div class="aviso info" style="margin:11px 0 0"><span class="aviso-i">◆</span><div><b>Checar antes de citar número:</b> ${esc(m.checarAoVivo)}</div></div>` : ''}
    </article>`).join('');
}

function renderConcorrencia() {
  $('#gradeConcorrencia').innerHTML = window.KB.INFLUENCIADORES.map(i => `
    <article class="perfil">
      <h3>${esc(i.nome)} ${i.validar ? '<span class="selo-validar">a validar</span>' : ''}</h3>
      <div class="sub">${esc(i.marca || '')}</div>
      ${i.obra ? `<div class="origem">${esc(i.obra)}</div>` : ''}
      ${i.posicionamento ? `<div class="princ"><b>Posicionamento</b><p>${esc(i.posicionamento)}</p></div>` : ''}
      ${i.padraoConteudo ? `<div class="princ"><b>Padrão de conteúdo</b><p>${esc(i.padraoConteudo)}</p></div>` : ''}
      ${(i.ondeEleGanha || i.ondeElaGanha) ? `<div class="princ"><b>Onde essa pessoa ganha</b><p>${esc(i.ondeEleGanha || i.ondeElaGanha)}</p></div>` : ''}
      ${i.ondeVoceGanha ? `<div class="angulo" style="margin-bottom:0"><b>Onde você ganha</b>${esc(i.ondeVoceGanha)}</div>` : ''}
      ${i.validar ? `<div class="aviso alerta" style="margin:11px 0 0"><span class="aviso-i">▲</span><div>Perfil não confirmado pelo sistema. A varredura busca dados reais antes de usar.</div></div>` : ''}
    </article>`).join('');
}

function renderProdutos() {
  const sel = (n) => n === 1 ? '<span class="tag tag-produto">Receita alta</span>' : n === 2 ? '<span class="tag tag-formato">Receita média</span>' : '<span class="tag tag-fonte">Complementar</span>';
  $('#gradeProdutos').innerHTML = window.KB.PRODUTOS
    .slice().sort((a, b) => a.prioridade - b.prioridade)
    .map(p => `
    <article class="perfil">
      <h3>${esc(p.nome)}</h3>
      <div style="margin:6px 0 12px">${sel(p.prioridade)}</div>
      <div class="princ"><b>Dor que resolve</b><p>${esc(p.dor)}</p></div>
      <div class="angulo"><b>Gatilho narrativo</b>${esc(p.gatilho)}</div>
      <div class="princ"><b>Público</b><p>${esc(p.publico)}</p></div>
      <div class="princ"><b>Âncora técnica</b><p>${esc(p.ancoraTecnica)}</p></div>
      <div class="princ"><b>CTA curto</b><p style="font-style:italic">"${esc(p.ctaCurto)}"</p></div>
      <div class="princ"><b>CTA longo</b><p style="font-style:italic">"${esc(p.ctaLongo)}"</p></div>
      ${arr(p.objecoes).length ? `<div class="campo" style="margin-top:12px"><div class="rotulo">Objeções antecipadas</div><ul class="lista-limpa">${p.objecoes.map(o => `<li><b style="color:var(--vermelho)">"${esc(o[0])}"</b><br>${esc(o[1])}</li>`).join('')}</ul></div>` : ''}
      ${arr(p.dadosParaChecar).length ? `<div class="aviso info" style="margin:11px 0 0"><span class="aviso-i">◆</span><div><b>Confirmar antes de citar:</b> ${p.dadosParaChecar.map(esc).join(' · ')}</div></div>` : ''}
    </article>`).join('');
}

function renderFontes() {
  $('#gradeFontes').innerHTML = window.DADOS.FONTES_TENDENCIA.map(f => `
    <a class="fonte-link" href="${esc(f.url)}" target="_blank" rel="noopener">
      <div style="flex:1;min-width:0">
        <div class="nome">${esc(f.nome)}</div>
        <div class="tipo">${esc(f.tipo)}${f.gratis === false ? ' · pago' : f.gratis === 'parcial' ? ' · freemium' : ' · grátis'}</div>
      </div>
      <span style="color:var(--txt-3)">↗</span>
    </a>`).join('');

  $('#gradeSeries').innerHTML = window.DADOS.SERIES.map(s => `
    <a class="fonte-link" href="${esc(window.DADOS.linkSerie(s.cod))}" target="_blank" rel="noopener">
      <div style="flex:1;min-width:0">
        <div class="nome">${esc(s.rotulo)}</div>
        <div class="tipo">BCB · série ${s.cod} · ${esc(s.tipo)}</div>
      </div>
      <span style="color:var(--txt-3)">↗</span>
    </a>`).join('');
}

function renderHistorico() {
  const h = window.CFG.lerHistorico();
  const area = $('#areaHistorico');
  if (!h.length) {
    area.innerHTML = `<div class="vazio"><div class="vazio-i">▤</div><h3>Nada salvo ainda</h3><p>Gere um pacote e clique em <b>Salvar</b> para guardá-lo aqui.</p></div>`;
    return;
  }
  area.innerHTML = h.map(item => `
    <div class="hist">
      <div class="info">
        <h4>${esc(item.tema || 'Sem título')}</h4>
        <span>${new Date(item.salvoEm).toLocaleString('pt-BR')}</span>
      </div>
      <button class="btn btn-sm btn-fantasma" data-abrir="${esc(item.id)}">Abrir</button>
      <button class="btn btn-sm btn-fantasma" data-baixar="${esc(item.id)}">.md</button>
      <button class="btn btn-sm btn-fantasma" data-remover="${esc(item.id)}">Excluir</button>
    </div>`).join('');

  area.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => {
    const item = window.CFG.lerHistorico().find(x => x.id === b.dataset.abrir);
    if (!item) return;
    APP.pacote = item;
    irPara('pacote');
    $('#tituloPacote').textContent = item.tema || 'Pacote salvo';
    renderPacote(item);
    window.TP.definirRoteiros(
      item.roteiroShort && item.roteiroShort.texto,
      item.roteiroLongo && item.roteiroLongo.texto,
      {
        short: Number(item.roteiroShort && item.roteiroShort.duracaoEstimadaSeg) || 0,
        longo: (Number(item.roteiroLongo && item.roteiroLongo.duracaoEstimadaMin) || 0) * 60
      }
    );
    $('#acoesPacote').style.display = 'flex';
  });
  area.querySelectorAll('[data-baixar]').forEach(b => b.onclick = () => {
    const item = window.CFG.lerHistorico().find(x => x.id === b.dataset.baixar);
    if (item) baixar(nomeArquivo(item), pacoteParaMarkdown(item));
  });
  area.querySelectorAll('[data-remover]').forEach(b => b.onclick = () => {
    window.CFG.removerDoHistorico(b.dataset.remover);
    renderHistorico();
    toast('Removido.', 'ok', 1800);
  });
}

/* =========================================================================
   CONFIGURACOES
   ========================================================================= */
function abrirConfig() {
  const c = APP.cfg;

  // Chaves e modelos, um bloco por provedor
  window.IA.ORDEM_PROVEDORES.forEach(id => {
    const prov = window.IA.PROVEDORES[id];
    const Cap = id.charAt(0).toUpperCase() + id.slice(1);

    const campo = $('#cfgChave' + (id === 'openrouter' ? 'OpenRouter' : Cap));
    if (campo) campo.value = c[prov.campoChave] || '';

    const sel = $('#cfgModelo' + Cap);
    if (sel) {
      sel.innerHTML = prov.modelos
        .map(m => `<option value="${esc(m.id)}">${esc(m.rotulo)}</option>`).join('');
      const escolhido = window.IA.modeloEscolhido(c, id);
      if (![...sel.options].some(o => o.value === escolhido)) {
        sel.add(new Option(escolhido, escolhido), 0);
      }
      sel.value = escolhido;
    }
    const st = $('#status' + Cap);
    if (st) { st.textContent = ''; st.className = 'prov-status'; }
  });

  // O catálogo vivo da OpenRouter entra por cima da lista curta.
  preencherModelosOpenRouter(c);

  $('#cfgProvedor').innerHTML = window.IA.ORDEM_PROVEDORES
    .map(id => `<option value="${esc(id)}">${esc(window.IA.PROVEDORES[id].nome)}</option>`).join('');
  $('#cfgProvedor').value = c.provedor;
  $('#cfgPerguntar').checked = !!c.perguntarProvedor;

  $('#cfgTemp').value = c.temperatura;
  $('#cfgTempVal').textContent = c.temperatura;
  $('#cfgBuscaWeb').checked = c.buscaWeb;

  ['marca', 'credenciais', 'formacao', 'experiencia', 'instituicoes', 'publico'].forEach(k => {
    const el = $('#cfg' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.value = c[k] || '';
  });
  $('#cfgFormato').value = c.formatoPadrao;

  $('#cfgProduto').innerHTML = '<option value="">A IA escolhe pela dor da pauta</option>' +
    window.KB.PRODUTOS.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
  $('#cfgProduto').value = c.produtoPreferido || '';

  $('#modalConfig').classList.add('on');
}

/* Catálogo vivo da OpenRouter: endpoint público, funciona sem chave. */
async function preencherModelosOpenRouter(c) {
  const sel = $('#cfgModeloOpenrouter');
  const aviso = $('#avisoCatalogo');
  if (!sel) return;
  try {
    const cat = APP.catalogo || (APP.catalogo = await window.CATALOGO.catalogoModelos());
    const grupo = (rot, itens) => itens.length
      ? `<optgroup label="${esc(rot)}">` + itens.map(m =>
          `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('') + '</optgroup>'
      : '';
    sel.innerHTML =
      '<optgroup label="Automático"><option value="auto">Automático — melhor gratuito</option></optgroup>'
      + grupo('Roteadores', cat.roteadores)
      + grupo(`Gratuitos (${cat.gratuitos.length})`, cat.gratuitos)
      + grupo(`Pagos (${cat.pagos.length})`, cat.pagos);
    const escolhido = window.IA.modeloEscolhido(c, 'openrouter');
    if (![...sel.querySelectorAll('option')].some(o => o.value === escolhido)) {
      sel.add(new Option(escolhido, escolhido), 0);
    }
    sel.value = escolhido;
    if (aviso) aviso.textContent = `${cat.gratuitos.length} gratuitos e ${cat.pagos.length} pagos no catálogo.`;
  } catch (e) {
    if (aviso) aviso.textContent = 'Não consegui ler o catálogo da OpenRouter; usando a lista curta.';
  }
}

function salvarConfig() {
  const c = APP.cfg;

  window.IA.ORDEM_PROVEDORES.forEach(id => {
    const prov = window.IA.PROVEDORES[id];
    const Cap = id.charAt(0).toUpperCase() + id.slice(1);
    const campo = $('#cfgChave' + (id === 'openrouter' ? 'OpenRouter' : Cap));
    if (campo) c[prov.campoChave] = campo.value.trim();
    const sel = $('#cfgModelo' + Cap);
    if (sel) c['modelo' + Cap] = sel.value;
  });

  c.provedor = $('#cfgProvedor').value;
  c.perguntarProvedor = $('#cfgPerguntar').checked;
  c.temperatura = parseFloat($('#cfgTemp').value);
  c.buscaWeb = $('#cfgBuscaWeb').checked;

  ['marca', 'credenciais', 'formacao', 'experiencia', 'instituicoes', 'publico'].forEach(k => {
    const el = $('#cfg' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) c[k] = el.value.trim();
  });
  c.formatoPadrao = $('#cfgFormato').value;
  c.produtoPreferido = $('#cfgProduto').value;

  window.CFG.salvarCfg(c);
  atualizarStatus();
  $('#modalConfig').classList.remove('on');
  toast('Configurações salvas.', 'ok');
}

function atualizarStatus() {
  const p = $('#statusApi');
  const prontos = window.IA.provedoresProntos(APP.cfg);
  const nomes = prontos.map(id => window.IA.PROVEDORES[id].nome.split(' ')[0]);
  p.innerHTML = `<span class="ponto ${prontos.length ? 'on' : 'off'}"></span><span>${
    prontos.length ? nomes.join(' · ') : 'Sem chave'}</span>`;
  p.title = prontos.length
    ? `Chaves configuradas: ${prontos.map(id => window.IA.PROVEDORES[id].nome).join(', ')}`
    : 'Nenhuma chave configurada';
  $('#logoMarca').textContent = APP.cfg.marca || 'Central de Conteúdo';
}

/* =========================================================================
   INICIALIZACAO
   ========================================================================= */
/* Elementos que o app.js precisa encontrar no HTML. Se algum sumir, a pasta
   esta com arquivos de versoes diferentes - e o usuario tem que saber disso,
   nao descobrir pela tela vazia. */
const ELEMENTOS_ESPERADOS = [
  '#btnVarrer', '#btnAtualizarMacro', '#btnConfig', '#btnSalvarConfig',
  '#btnCopiarTudo', '#btnBaixar', '#btnSlides', '#btnSalvar', '#btnTeleprompter',
  '#btnExportarTudo', '#btnColher', '#btnLimparDados',
  '#gradeMestres', '#gradeProdutos', '#gradeConcorrencia',
  '#statusApi', '#statusColetor', '#areaPacote', '#areaPautas'
];

// Exposto para o teste conferir a lista sem duplicar nada.
if (typeof window !== 'undefined') window.ELEMENTOS_ESPERADOS = ELEMENTOS_ESPERADOS;

const FALHAS_BOOT = [];

/* Liga um handler SO se o elemento existir.

   Antes isto era `$('#btn').onclick = fn` direto, dezenas de vezes seguidas. Um
   unico elemento ausente levantava TypeError e matava todo o resto de iniciar():
   as telas de Mestres, Esteira e Concorrencia ficavam vazias, os selos travavam
   no texto inicial do HTML, o coletor nunca era consultado - e nada na tela
   dizia o motivo. Uma tela em branco nao pode ser o jeito de descobrir isso. */
function ligar(seletor, evento, fn) {
  const el = $(seletor);
  if (el) { el[evento] = fn; return el; }
  FALHAS_BOOT.push(`elemento ausente: ${seletor}`);
  return null;
}

/* Cada etapa do arranque roda isolada: uma falhando, as outras seguem. */
function etapa(nome, fn) {
  try { fn(); }
  catch (e) { FALHAS_BOOT.push(`${nome}: ${e.message}`); }
}

function avisarPastaMisturada() {
  const faltando = ELEMENTOS_ESPERADOS.filter(sel => !$(sel));
  if (!faltando.length && !FALHAS_BOOT.length) return;

  const d = document.createElement('div');
  d.className = 'aviso alerta';
  d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;box-shadow:0 12px 34px rgba(0,0,0,.5)';
  d.innerHTML = `<span class="aviso-i">▲</span><div>
    <b>Esta pasta está com arquivos de versões diferentes.</b><br>
    O <code>index.html</code> e o <code>js/app.js</code> não são do mesmo pacote, então parte da
    ferramenta não iniciou — telas podem aparecer vazias e os selos do topo ficam parados.
    <div style="margin-top:8px"><b>Resolve assim:</b> recarregue segurando Shift
    (Cmd+Shift+R no Mac, Ctrl+Shift+R no Windows). Se continuar, apague a pasta inteira
    e extraia o <code>.zip</code> de novo — trocar só alguns arquivos é o que causa isso.</div>
    ${faltando.length ? `<div style="margin-top:8px;font-size:12px;opacity:.8">Faltando no HTML: ${faltando.map(esc).join(', ')}</div>` : ''}
    ${FALHAS_BOOT.length ? `<div style="margin-top:6px;font-size:12px;opacity:.8">${FALHAS_BOOT.map(esc).join(' · ')}</div>` : ''}
    <button class="btn btn-sm btn-fantasma" style="margin-top:10px" onclick="this.closest('.aviso').remove()">Fechar</button>
  </div>`;
  document.body.appendChild(d);
}

function iniciar() {
  APP.cfg = window.CFG.lerCfg();

  etapa('teleprompter', () => window.TP.iniciar());

  etapa('abas', () => {
    $$('.aba').forEach(a => a.onclick = () => {
      irPara(a.dataset.tela);
      if (a.dataset.tela === 'historico') renderHistorico();
      if (a.dataset.tela === 'termometro') renderTermometro('#areaTermometroFull');
    });
  });

  etapa('botoes', () => {
    ligar('#btnVarrer', 'onclick', rodarVarredura);
    const b2 = $('#btnVarrer2');
    if (b2) b2.onclick = rodarVarredura;          // opcional: so existe na tela vazia
    ligar('#btnAtualizarMacro', 'onclick', carregarMacro);

    ligar('#btnConfig', 'onclick', abrirConfig);
    ligar('#btnFecharConfig', 'onclick', () => $('#modalConfig').classList.remove('on'));
    ligar('#btnSalvarConfig', 'onclick', salvarConfig);
    ligar('#modalConfig', 'onclick', (e) => {
      if (e.target.id === 'modalConfig') $('#modalConfig').classList.remove('on');
    });
    ligar('#cfgTemp', 'oninput', (e) => { const v = $('#cfgTempVal'); if (v) v.textContent = e.target.value; });

    ligar('#btnCopiarTudo', 'onclick', () => copiar(pacoteParaMarkdown(APP.pacote), 'Pacote inteiro'));
    ligar('#btnBaixar', 'onclick', () => baixar(nomeArquivo(APP.pacote), pacoteParaMarkdown(APP.pacote)));
    ligar('#btnSlides', 'onclick', () => baixarSlides(APP.pacote));
    ligar('#btnSalvar', 'onclick', () => {
      window.CFG.salvarNoHistorico(APP.pacote);
      toast('Pacote salvo no histórico.', 'ok');
    });
    ligar('#btnTeleprompter', 'onclick', () => window.TP.abrir());
    ligar('#btnColher', 'onclick', () => colherManchetes('#areaTermometroFull'));

    ligar('#btnExportarTudo', 'onclick', () => {
      const h = window.CFG.lerHistorico();
      if (!h.length) return toast('Nada para exportar.', 'err');
      baixar(`radar-institucional-${new Date().toISOString().slice(0, 10)}.json`,
             JSON.stringify(h, null, 2), 'application/json');
    });

    ligar('#btnLimparDados', 'onclick', () => {
      if (!confirm('Isso apaga sua chave, suas configurações e todo o histórico salvo neste navegador. Confirma?')) return;
      localStorage.clear();
      location.reload();
    });
  });

  etapa('campos de chave', () => {
    // Limpa espacos e quebras de linha assim que o campo perde o foco.
    ['#cfgChaveAnthropic', '#cfgChaveGemini', '#cfgChaveOpenRouter'].forEach(sel => {
      const el = $(sel);
      if (el) el.onblur = () => { el.value = window.IA.limparChave(el.value); };
    });

    // Mostrar/ocultar a chave: sem isso nao da para conferir uma colagem torta,
    // que e justamente a causa mais comum de falha de autenticacao.
    document.querySelectorAll('[data-olho]').forEach(btn => {
      btn.onclick = () => {
        const campo = $('#' + btn.dataset.olho);
        if (!campo) return;
        const visivel = campo.type === 'text';
        campo.type = visivel ? 'password' : 'text';
        btn.textContent = visivel ? '👁' : '🙈';
        btn.title = visivel ? 'Mostrar a chave' : 'Ocultar a chave';
        btn.setAttribute('aria-label', btn.title);
      };
    });

    document.querySelectorAll('[data-testar]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.testar;
        const Cap = id.charAt(0).toUpperCase() + id.slice(1);
        const alvo = $('#status' + Cap);
        const campo = $('#cfgChave' + (id === 'openrouter' ? 'OpenRouter' : Cap));
        const sel = $('#cfgModelo' + Cap);
        if (!alvo || !campo) return;
        alvo.textContent = 'testando…';
        alvo.className = 'prov-status';
        const provisorio = Object.assign({}, APP.cfg, {
          [window.IA.PROVEDORES[id].campoChave]: campo.value.trim(),
          ['modelo' + Cap]: sel ? sel.value : undefined
        });
        const r = await window.IA.testarChave(provisorio, id);
        alvo.textContent = r.mensagem;
        alvo.className = 'prov-status ' + (r.ok ? 'ok' : 'erro');
      };
    });
  });

  etapa('coletor', () => {
    window.DADOS.servidorDisponivel().then(ok => {
      APP.temServidor = ok;
      etapa('termometro', () => renderTermometro('#areaTermometroFull'));
      const p = $('#statusColetor');
      if (p) p.innerHTML = ok
        ? '<span class="ponto on"></span><span>Coletor ativo</span>'
        : '<span class="ponto off"></span><span>Sem coletor</span>';
    }).catch(() => {
      const p = $('#statusColetor');
      if (p) p.innerHTML = '<span class="ponto off"></span><span>Sem coletor</span>';
    });
  });

  // Cada tela isolada: uma quebrando, as outras continuam preenchidas.
  etapa('mestres', renderMestres);
  etapa('concorrencia', renderConcorrencia);
  etapa('produtos', renderProdutos);
  etapa('fontes', renderFontes);
  etapa('historico', renderHistorico);
  etapa('status', atualizarStatus);
  etapa('macro', carregarMacro);

  etapa('aviso de chave', () => {
    if (!window.IA.provedoresProntos(APP.cfg).length) {
      setTimeout(() => {
        toast('Configure ao menos uma chave de IA — Claude, Gemini ou OpenRouter — em Configurações.',
              'info', 8000);
      }, 1100);
    }
  });

  etapa('service worker', () => {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline opcional */ });
    }
  });

  avisarPastaMisturada();
}

/* Handlers inline no HTML gerado precisam destes nomes no escopo global. */
window.APP = APP;
window.copiar = copiar;
window.rodarVarredura = rodarVarredura;
window.gerarPacote = gerarPacote;

document.addEventListener('DOMContentLoaded', iniciar);
