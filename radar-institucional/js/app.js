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
    html += `<div class="aviso alerta"><span class="aviso-i">▲</span><div>
      <b>Estas pautas saíram SEM busca web e SEM coletor.</b><br>
      A busca da OpenRouter é cobrada por consulta e não pôde ser executada agora
      — normalmente por falta de saldo. As pautas abaixo foram construídas apenas
      com os dados do Banco Central que você vê no painel, que são reais e datados,
      e não com notícia das últimas 72 horas.
      <div style="margin-top:8px"><b>Na prática:</b> os ângulos são válidos e os
      números são verdadeiros, mas nada aqui é novidade do dia. Antes de gravar
      qualquer pauta que mencione fato recente, confirme na fonte.</div>
      <div style="margin-top:8px;font-size:12px;opacity:.85">Para ligar a busca,
      adicione saldo em openrouter.ai/credits — a partir de US$ 0,007 por consulta.</div>
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
          <h4>${esc(a.termo)}</h4>
          <div class="meta">${a.volume} matérias · ${a.veiculos} veículos ·
            ${a.recentes6h} nas últimas 6h · ${(a.frentes || []).join(', ')}</div>
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
      maxTokens: 16000,
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

  /* --- 9. Fontes e checagem --- */
  const temFontes = arr(j.fontes).length || arr(j._citacoes).length || arr(j.checagem).length;
  if (temFontes) {
    h += bloco(9, 'Fontes e Checagem', `
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

  if (arr(j.checagem).length) {
    secao('9. Checagem');
    arr(j.checagem).forEach(c => L.push(`- [${String(c.status).toUpperCase().includes('NA') || String(c.status).toUpperCase().includes('NÃ') ? ' ' : 'x'}] **${c.dado}** — ${c.onde}`));
  }
  if (arr(j.fontes).length) {
    L.push('\n**Fontes:**');
    arr(j.fontes).forEach(f => L.push(`- ${f.afirmacao} — ${f.veiculo} ${f.data || ''} ${f.url || ''}`));
  }

  L.push(`\n---\n\n_${window.KB.COMPLIANCE.disclaimerLongo}_`);
  return L.join('\n');
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
function iniciar() {
  APP.cfg = window.CFG.lerCfg();
  window.TP.iniciar();

  $$('.aba').forEach(a => a.onclick = () => {
    irPara(a.dataset.tela);
    if (a.dataset.tela === 'historico') renderHistorico();
    if (a.dataset.tela === 'termometro') renderTermometro('#areaTermometroFull');
  });

  $('#btnVarrer').onclick = rodarVarredura;
  const b2 = $('#btnVarrer2');
  if (b2) b2.onclick = rodarVarredura;
  $('#btnAtualizarMacro').onclick = carregarMacro;

  $('#btnConfig').onclick = abrirConfig;
  $('#btnFecharConfig').onclick = () => $('#modalConfig').classList.remove('on');
  $('#btnSalvarConfig').onclick = salvarConfig;
  $('#modalConfig').onclick = (e) => { if (e.target.id === 'modalConfig') $('#modalConfig').classList.remove('on'); };

  $('#cfgTemp').oninput = (e) => $('#cfgTempVal').textContent = e.target.value;

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

  $('#btnLimparDados').onclick = () => {
    if (!confirm('Isso apaga sua chave, suas configurações e todo o histórico salvo neste navegador. Confirma?')) return;
    localStorage.clear();
    location.reload();
  };

  $('#btnCopiarTudo').onclick = () => copiar(pacoteParaMarkdown(APP.pacote), 'Pacote inteiro');
  $('#btnBaixar').onclick = () => baixar(nomeArquivo(APP.pacote), pacoteParaMarkdown(APP.pacote));
  $('#btnSalvar').onclick = () => {
    window.CFG.salvarNoHistorico(APP.pacote);
    toast('Pacote salvo no histórico.', 'ok');
  };
  $('#btnTeleprompter').onclick = () => window.TP.abrir();

  $('#btnExportarTudo').onclick = () => {
    const h = window.CFG.lerHistorico();
    if (!h.length) return toast('Nada para exportar.', 'err');
    baixar(`radar-institucional-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(h, null, 2), 'application/json');
  };

  $('#btnColher').onclick = () => colherManchetes('#areaTermometroFull');

  window.DADOS.servidorDisponivel().then(ok => {
    APP.temServidor = ok;
    renderTermometro('#areaTermometroFull');
    const p = $('#statusColetor');
    if (p) p.innerHTML = ok
      ? '<span class="ponto on"></span><span>Coletor ativo</span>'
      : '<span class="ponto off"></span><span>Sem coletor</span>';
  });

  renderMestres();
  renderConcorrencia();
  renderProdutos();
  renderFontes();
  renderHistorico();
  atualizarStatus();
  carregarMacro();

  if (!window.IA.provedoresProntos(APP.cfg).length) {
    setTimeout(() => {
      toast('Configure ao menos uma chave de IA — Claude, Gemini ou OpenRouter — em Configurações.',
            'info', 8000);
    }, 1100);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline opcional */ });
  }
}

/* Handlers inline no HTML gerado precisam destes nomes no escopo global. */
window.APP = APP;
window.copiar = copiar;
window.rodarVarredura = rodarVarredura;
window.gerarPacote = gerarPacote;

document.addEventListener('DOMContentLoaded', iniciar);
