/* =========================================================================
   RADAR INSTITUCIONAL - Base de Conhecimento
   -------------------------------------------------------------------------
   REGRA DE OURO DESTE ARQUIVO:
   Nada aqui pode ser inventado. Todo principio tem origem rastreavel
   (livro + ano, carta ao acionista, metodo publico ou entrevista).
   Perfis marcados com "validar: true" NAO sao afirmados pelo sistema:
   a ferramenta busca na web antes de usar. Isso e proposital.
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. OS MESTRES - principios fundamentais para ancorar roteiros
   ------------------------------------------------------------------------- */
const MESTRES = [
  {
    id: 'graham',
    nome: 'Benjamin Graham',
    vida: '1894-1976',
    titulo: 'O Pai do Value Investing',
    origem: 'Security Analysis (1934, com David Dodd) e O Investidor Inteligente (1949)',
    principios: [
      {
        nome: 'Margem de Seguranca',
        essencia: 'Comprar por preco significativamente abaixo do valor intrinseco. A diferenca absorve o erro de analise e o azar.',
        fonte: 'O Investidor Inteligente, cap. 20'
      },
      {
        nome: 'Mr. Market',
        essencia: 'O mercado e um socio maniaco-depressivo que todo dia te oferece um preco. Voce nao e obrigado a aceitar - so a aproveitar quando ele enlouquece.',
        fonte: 'O Investidor Inteligente, cap. 8'
      },
      {
        nome: 'Investimento x Especulacao',
        essencia: 'Investimento e a operacao que, apos analise, promete seguranca do principal e retorno adequado. Tudo o mais e especulacao.',
        fonte: 'O Investidor Inteligente, cap. 1'
      }
    ],
    ganchoViral: 'O homem que ensinou Buffett dizia que 90% do que chamam de investimento e aposta disfarcada.',
    usarQuando: ['euforia de mercado', 'ativo caro', 'hype', 'FOMO', 'bolha', 'cripto', 'IPO']
  },
  {
    id: 'buffett',
    nome: 'Warren Buffett',
    vida: 'n. 1930',
    titulo: 'O Investidor Lendario',
    origem: 'Cartas anuais aos acionistas da Berkshire Hathaway (1965-presente)',
    principios: [
      {
        nome: 'Circulo de Competencia',
        essencia: 'Nao importa o tamanho do circulo. Importa saber exatamente onde fica a borda dele.',
        fonte: 'Carta aos acionistas da Berkshire, 1996'
      },
      {
        nome: 'Fosso Economico (Moat)',
        essencia: 'Procure negocios com vantagem competitiva duravel, nao empresas que so estao com um bom trimestre.',
        fonte: 'Cartas Berkshire, uso recorrente desde os anos 1980'
      },
      {
        nome: 'Contrarianismo Disciplinado',
        essencia: 'Seja temeroso quando os outros sao gananciosos, e ganancioso quando os outros sao temerosos.',
        fonte: 'Carta aos acionistas da Berkshire, 1986'
      },
      {
        nome: 'Horizonte',
        essencia: 'Nosso periodo de manutencao favorito e para sempre.',
        fonte: 'Carta aos acionistas da Berkshire, 1988'
      }
    ],
    ganchoViral: 'Buffett bateu o S&P 500 por quase 60 anos fazendo o oposto do que o mercado grita todo dia.',
    usarQuando: ['panico', 'queda de bolsa', 'longo prazo', 'paciencia', 'juros compostos', 'crise'],
    checarAoVivo: 'Retorno anualizado da Berkshire vs S&P 500 - conferir na carta anual mais recente antes de citar numero.'
  },
  {
    id: 'lynch',
    nome: 'Peter Lynch',
    vida: 'n. 1944',
    titulo: 'O Gestor de Fundos de Sucesso',
    origem: 'Fidelity Magellan Fund (1977-1990); livros One Up on Wall Street (1989) e Beating the Street (1993)',
    principios: [
      {
        nome: 'Invista no que voce entende',
        essencia: 'O investidor comum tem vantagem: ele ve a tendencia no shopping, no trabalho e na rua antes de Wall Street colocar no relatorio.',
        fonte: 'One Up on Wall Street (1989)'
      },
      {
        nome: 'Tenbagger',
        essencia: 'Uma unica acao que multiplica por 10 carrega uma carteira inteira de erros.',
        fonte: 'One Up on Wall Street (1989)'
      },
      {
        nome: 'As 6 categorias',
        essencia: 'Slow growers, stalwarts, fast growers, ciclicas, turnarounds e asset plays. Cada uma tem regra propria - tratar tudo igual e o erro do amador.',
        fonte: 'One Up on Wall Street (1989)'
      }
    ],
    ganchoViral: 'Lynch entregou cerca de 29% ao ano por 13 anos e dizia que o investidor comum pode ganhar do gestor profissional.',
    usarQuando: ['acoes', 'stock picking', 'small caps', 'consumo', 'varejo', 'tese simples'],
    checarAoVivo: 'Retorno anualizado do Magellan (aprox. 29% a.a. entre 1977-1990) - confirmar antes de citar.'
  },
  {
    id: 'bogle',
    nome: 'John C. Bogle',
    vida: '1929-2019',
    titulo: 'O Criador do Fundo de Indice',
    origem: 'Fundador da Vanguard (1975); O Pequeno Livro do Investimento de Bom Senso (2007)',
    principios: [
      {
        nome: 'Custo e o inimigo',
        essencia: 'No mercado, voce nao recebe o que paga. Voce recebe exatamente o que NAO paga em taxa.',
        fonte: 'O Pequeno Livro do Investimento de Bom Senso (2007)'
      },
      {
        nome: 'Compre o palheiro',
        essencia: 'Nao procure a agulha no palheiro. Compre o palheiro inteiro.',
        fonte: 'O Pequeno Livro do Investimento de Bom Senso (2007)'
      }
    ],
    ganchoViral: 'Bogle provou com matematica que a taxa que voce nem percebe come decadas do seu patrimonio.',
    usarQuando: ['taxa de administracao', 'fundos', 'banco', 'ETF', 'custo', 'previdencia', 'come-cotas']
  },
  {
    id: 'munger',
    nome: 'Charlie Munger',
    vida: '1924-2023',
    titulo: 'O Arquiteto dos Modelos Mentais',
    origem: 'Vice-presidente da Berkshire Hathaway; Poor Charlie’s Almanack (2005)',
    principios: [
      {
        nome: 'Inversao',
        essencia: 'Inverta, sempre inverta. Em vez de perguntar como ter sucesso, pergunte o que garante o fracasso - e nao faca isso.',
        fonte: 'Poor Charlie’s Almanack (2005)'
      },
      {
        nome: 'Latticework de modelos mentais',
        essencia: 'Quem so tem um modelo mental distorce todo problema para caber nele.',
        fonte: 'Poor Charlie’s Almanack (2005)'
      }
    ],
    ganchoViral: 'Munger resolvia problema financeiro ao contrario: primeiro listava tudo que destroi patrimonio.',
    usarQuando: ['erro do investidor', 'vies', 'psicologia', 'decisao', 'armadilha']
  },
  {
    id: 'fisher',
    nome: 'Philip Fisher',
    vida: '1907-2004',
    titulo: 'O Pioneiro do Growth Investing',
    origem: 'Common Stocks and Uncommon Profits (1958)',
    principios: [
      {
        nome: 'Scuttlebutt',
        essencia: 'Antes de comprar, converse com clientes, fornecedores, concorrentes e ex-funcionarios. O balanco conta o passado; eles contam o futuro.',
        fonte: 'Common Stocks and Uncommon Profits (1958)'
      }
    ],
    ganchoViral: 'Fisher nao lia so balanco: ele investigava a empresa como detetive antes de investir um centavo.',
    usarQuando: ['analise de empresa', 'qualidade', 'gestao', 'due diligence']
  },
  {
    id: 'dalio',
    nome: 'Ray Dalio',
    vida: 'n. 1949',
    titulo: 'O Macro dos Ciclos de Divida',
    origem: 'Fundador da Bridgewater Associates; Principios (2017) e Big Debt Crises (2018)',
    principios: [
      {
        nome: 'Ciclo de divida de longo prazo',
        essencia: 'Toda economia repete o mesmo ciclo de alavancagem, estouro e desalavancagem. Quem entende o ciclo nao se assusta com o noticiario.',
        fonte: 'Big Debt Crises (2018)'
      },
      {
        nome: 'Diversificacao entre ambientes',
        essencia: 'Diversifique entre cenarios economicos, nao entre ativos que sobem e caem juntos.',
        fonte: 'Conceito do portfolio All Weather, Bridgewater'
      }
    ],
    ganchoViral: 'Dalio avisa: a maior parte dos investidores acha que esta diversificada e tem tudo apostado no mesmo cenario.',
    usarQuando: ['divida publica', 'macro', 'crise', 'diversificacao', 'cambio', 'juros', 'fiscal']
  },
  {
    id: 'templeton',
    nome: 'John Templeton',
    vida: '1912-2008',
    titulo: 'O Contrarian Global',
    origem: 'Templeton Growth Fund (1954)',
    principios: [
      {
        nome: 'Ponto de pessimismo maximo',
        essencia: 'O momento de comprar e quando o pessimismo esta no auge; o de vender, quando o otimismo esta.',
        fonte: 'Maxima atribuida a Templeton, repetida em suas entrevistas e materiais da Templeton Funds'
      }
    ],
    ganchoViral: 'Templeton ficou bilionario comprando exatamente o que estava na capa dos jornais como desastre.',
    usarQuando: ['panico', 'manchete negativa', 'setor odiado', 'contrarian', 'exterior']
  },
  {
    id: 'kiyosaki',
    nome: 'Robert Kiyosaki',
    vida: 'n. 1947',
    titulo: 'O Popularizador da Educacao Financeira',
    origem: 'Pai Rico, Pai Pobre (1997)',
    principios: [
      {
        nome: 'Ativo x Passivo',
        essencia: 'Ativo poe dinheiro no seu bolso. Passivo tira. A maioria compra passivo achando que esta comprando ativo.',
        fonte: 'Pai Rico, Pai Pobre (1997)'
      },
      {
        nome: 'Divida boa x divida ruim',
        essencia: 'Divida que compra ativo gerador de renda trabalha para voce. Divida que compra consumo trabalha contra voce.',
        fonte: 'Pai Rico, Pai Pobre (1997)'
      }
    ],
    ganchoViral: 'A frase de Kiyosaki que mais irrita economista: sua casa propria nao e um ativo.',
    usarQuando: ['imovel', 'divida', 'alavancagem', 'renda passiva', 'mentalidade', 'CGI'],
    alerta: 'Kiyosaki e popular mas contestado por rigor tecnico. Use o conceito (ativo x passivo, divida boa) como porta de entrada e ancore o rigor em Graham, Buffett ou dado do BCB. Nunca use previsao de colapso dele como fato.'
  },
  {
    id: 'barsi',
    nome: 'Luiz Barsi Filho',
    vida: 'n. 1939',
    titulo: 'O Maior Investidor Pessoa Fisica da B3',
    origem: 'Metodo publico BESST, difundido em entrevistas e no material da Acao Educacional Barsi',
    principios: [
      {
        nome: 'Carteira Previdenciaria',
        essencia: 'Nao invista para vender. Invista para receber. A acao e a maquina; o dividendo e o salario.',
        fonte: 'Entrevistas publicas de Barsi e material da Acao Educacional Barsi'
      },
      {
        nome: 'Metodo BESST',
        essencia: 'Bancos, Energia, Saneamento, Seguros e Telecomunicacoes: setores perenes, regulados e com demanda inelastica.',
        fonte: 'Metodo publico atribuido a Barsi, citado por ele em entrevistas'
      }
    ],
    ganchoViral: 'Barsi construiu bilhoes comprando o que o mercado chama de acao chata e sem graca.',
    usarQuando: ['dividendos', 'renda passiva', 'aposentadoria', 'previdencia', 'longo prazo', 'tributacao de dividendos']
  },
  {
    id: 'stuhlberger',
    nome: 'Luis Stuhlberger',
    vida: 'n. 1954',
    titulo: 'O Maior Track Record Macro do Brasil',
    origem: 'Gestor do Fundo Verde (Verde Asset Management), iniciado em 1997',
    principios: [
      {
        nome: 'Gestao macro com assimetria',
        essencia: 'Posicione-se onde o risco de perda e limitado e o de ganho e desproporcional. O resto e ruido.',
        fonte: 'Cartas mensais da Verde Asset e entrevistas publicas'
      },
      {
        nome: 'Ceticismo com o Brasil facil',
        essencia: 'A tese otimista sobre o Brasil precisa passar pelo teste da conta fiscal antes de virar posicao.',
        fonte: 'Cartas da Verde Asset'
      }
    ],
    ganchoViral: 'O gestor mais respeitado do Brasil olha uma variavel antes de qualquer acao: a divida publica.',
    usarQuando: ['macro', 'fiscal', 'juros', 'divida', 'cambio', 'multimercado'],
    checarAoVivo: 'Posicionamento atual da Verde - buscar a carta mensal mais recente antes de afirmar qualquer posicao.'
  }
];

/* -------------------------------------------------------------------------
   2. RADAR DE CONCORRENCIA - criadores brasileiros a monitorar
   Campo "validar" = a ferramenta busca na web antes de afirmar qualquer coisa.
   ------------------------------------------------------------------------- */
const INFLUENCIADORES = [
  {
    nome: 'Thiago Nigro', marca: 'O Primo Rico',
    obra: 'Do Mil ao Milhao (2018)',
    posicionamento: 'Empreendedor-investidor. Tripe: gastar bem, investir melhor, ganhar mais.',
    padraoConteudo: 'Alta producao, storytelling de patrimonio proprio, convidados de peso, forte push de produto/comunidade.',
    ondeEleGanha: 'Escala de producao e prova social de patrimonio.',
    ondeVoceGanha: 'Ele fala como empreendedor que investe. Voce fala como quem sentou do outro lado da mesa em Itau, Santander e XP e viu a carteira real do cliente de alta renda.',
    validar: false
  },
  {
    nome: 'Eduardo Feldberg', marca: 'Primo Pobre',
    posicionamento: 'Contraponto humoristico ao Primo Rico; critica de guru e de produto caro.',
    padraoConteudo: 'Humor, ironia, desmonte de promessa milagrosa, cortes curtos.',
    ondeEleGanha: 'Humor e ceticismo popular.',
    ondeVoceGanha: 'Ele destroi a ma pratica mas raramente entrega a alternativa tecnica. Voce destroi E entrega o caminho com numero e fonte.',
    validar: false
  },
  {
    nome: 'Charles Wicz', marca: 'Economista Sincero',
    posicionamento: 'Analise economica critica, tom contrarian.',
    padraoConteudo: 'Video longo analitico, leitura de dado macro, tom de denuncia.',
    ondeVoceGanha: 'Ele analisa macro. Voce traduz macro em decisao concreta de carteira e de credito para quem tem patrimonio.',
    validar: true
  },
  {
    nome: 'Nathalia Arcuri', marca: 'Me Poupe!',
    obra: 'Me Poupe! (2018)',
    posicionamento: 'Educacao financeira de massa, linguagem popular e energetica.',
    padraoConteudo: 'Altissima energia, cortes rapidos, didatica de base.',
    ondeElaGanha: 'Alcance de massa e didatica de entrada.',
    ondeVoceGanha: 'O publico dela e iniciante. O seu tem patrimonio e problema de sucessao, tributacao e credito - dor que a base nao tem.',
    validar: false
  },
  {
    nome: 'Tiago Guitian Reis', marca: 'Suno Research',
    posicionamento: 'Value investing e dividendos com rigor de casa de analise.',
    padraoConteudo: 'Analitico, fundamentalista, tom sobrio.',
    ondeVoceGanha: 'Ele fala de ativo. Voce fala da estrutura completa: ativo + credito + protecao + sucessao.',
    validar: false
  },
  {
    nome: 'Bruno Perini', marca: 'Voce Mais Rico',
    posicionamento: 'Independencia financeira com base tecnica, perfil engenheiro.',
    padraoConteudo: 'Didatico, planilha, simulacao, tom calmo.',
    ondeVoceGanha: 'Ele simula. Voce executa - tem certificacao e esteira de produto para implementar.',
    validar: false
  },
  {
    nome: 'Raul Sena', marca: 'Investidor Sardinha',
    posicionamento: 'Anti-guru, linguagem direta e provocativa.',
    padraoConteudo: 'Provocacao, cortes agressivos, opiniao forte.',
    ondeVoceGanha: 'Ele provoca. Voce provoca com credencial e dado auditavel atras.',
    validar: false
  },
  {
    nome: 'Gustavo Cerbasi', marca: 'Cerbasi',
    obra: 'Casais Inteligentes Enriquecem Juntos (2004)',
    posicionamento: 'Planejamento financeiro familiar e de vida.',
    padraoConteudo: 'Sobrio, consultivo, foco em planejamento e familia.',
    ondeVoceGanha: 'Ele planeja. Voce planeja e estrutura sucessao com produto real.',
    validar: false
  },
  { nome: 'Leandro Ruschel', marca: 'Canal do Leandro Ruschel', posicionamento: 'Analise tecnica e macro.', validar: true },
  { nome: 'Hermann Greb', marca: '-', posicionamento: '', validar: true }
];

/* -------------------------------------------------------------------------
   3. ESTEIRA DE PRODUTOS BANKING - motor de CTA
   prioridade 1 = maior receita (foco declarado)
   ------------------------------------------------------------------------- */
const PRODUTOS = [
  {
    id: 'cgi',
    nome: 'Credito com Garantia de Imovel (Home Equity)',
    prioridade: 1,
    dor: 'Tem patrimonio imobilizado em imovel e paga juro caro em cheque especial, cartao ou emprestimo pessoal. Ou precisa de capital e nao quer vender ativo bom.',
    gatilho: 'Voce esta sentado em cima de um ativo de alto valor e tomando o credito mais caro do mercado.',
    publico: 'PF alta renda com imovel quitado; PJ com socio que tem imovel; investidor que quer alavancar sem vender carteira.',
    ancoraTecnica: 'Modalidade com uma das menores taxas do mercado PF e prazo longo, por ser garantida por alienacao fiduciaria do imovel.',
    ancoraMestre: 'kiyosaki',
    ancoraMestreMotivo: 'Divida boa x divida ruim: trocar divida cara de consumo por credito barato garantido e o exemplo mais limpo do conceito.',
    ctaCurto: 'Se voce tem imovel quitado e divida cara, voce nao tem problema de dinheiro - tem problema de estrutura. Chama que eu te mostro a conta.',
    ctaLongo: 'Antes de vender qualquer ativo da sua carteira, faz um exercicio: soma o que voce paga de juros hoje e compara com o custo de um credito garantido pelo seu imovel. Se a diferenca for maior que a rentabilidade da sua carteira, a conta se paga sozinha. Esse calculo eu faco com voce numa sessao.',
    objecoes: [
      ['Vou perder meu imovel?', 'A alienacao fiduciaria so e executada em inadimplencia. O desenho correto comeca pela capacidade de pagamento, nao pelo valor maximo liberado.'],
      ['E muita burocracia', 'A analise e de credito e de imovel. O prazo existe, mas o custo do dinheiro caro que voce paga hoje corre todo dia.']
    ],
    dadosParaChecar: ['Volume de concessao de home equity mais recente (ABECIP)', 'Taxa media da modalidade (BCB)', 'Taxa media de emprestimo pessoal e rotativo para comparacao (BCB)']
  },
  {
    id: 'consorcio',
    nome: 'Consorcio',
    prioridade: 1,
    dor: 'Quer comprar imovel, veiculo ou expandir empresa sem destruir a carteira com juros de financiamento.',
    gatilho: 'Financiamento voce paga o bem duas vezes. Consorcio voce troca juros por tempo e disciplina.',
    publico: 'Quem tem horizonte e nao tem pressa; investidor que quer usar carta como ferramenta de alavancagem planejada; PJ para maquina e frota.',
    ancoraTecnica: 'Nao ha incidencia de juros: ha taxa de administracao e fundo comum. A comparacao honesta e Custo Efetivo Total contra CET do financiamento.',
    ancoraMestre: 'bogle',
    ancoraMestreMotivo: 'Custo e o inimigo: a diferenca entre CET de consorcio e CET de financiamento composta por decadas.',
    ctaCurto: 'Se voce nao tem pressa, pagar juros de financiamento e uma escolha - nao uma necessidade. Te mostro a comparacao de CET.',
    ctaLongo: 'Consorcio nao e melhor que financiamento sempre. Ele e melhor quando voce tem tempo. Se voce precisa da chave amanha, financia. Se voce tem 3, 5 anos de horizonte, a diferenca de custo efetivo total fica no seu bolso e nao no do banco. Eu monto essa comparacao numero por numero.',
    objecoes: [
      ['E demorado', 'Sim. Esse e exatamente o preco que voce paga em vez de juros. A pergunta certa e se voce tem o tempo.'],
      ['E se eu precisar antes?', 'Existe lance. E a estrategia de lance faz parte do planejamento, nao e sorte.']
    ],
    dadosParaChecar: ['Dados do setor de consorcio (ABAC)', 'Taxa media de financiamento imobiliario e de veiculo (BCB)']
  },
  {
    id: 'seguros',
    nome: 'Seguros e Protecao Patrimonial',
    prioridade: 1,
    dor: 'Construiu patrimonio e nao protegeu. Um evento unico (morte, invalidez, doenca grave, sinistro) transfere o problema inteiro para a familia.',
    gatilho: 'Voce passou dez anos montando carteira e zero minuto protegendo ela contra o unico evento que zera tudo.',
    publico: 'Provedor principal da familia; socio de empresa; quem tem dependente ou divida de longo prazo.',
    ancoraTecnica: 'Seguro nao e investimento: e transferencia de risco. O criterio e custo do premio contra o tamanho do buraco que o evento abre.',
    ancoraMestre: 'graham',
    ancoraMestreMotivo: 'Margem de seguranca: seguro e a margem de seguranca aplicada a vida, nao ao balanco.',
    ctaCurto: 'Seu patrimonio tem plano A. Sua familia tem plano B? Se a resposta demorou, a gente precisa conversar.',
    ctaLongo: 'Existe uma pergunta que eu faco em toda primeira reuniao e que trava o cliente: se voce parar de gerar renda amanha, por quantos meses a sua familia mantem o padrao atual? Quem responde menos de vinte e quatro meses tem um problema de protecao, nao de investimento. E protecao custa uma fracao do que a maioria imagina.',
    objecoes: [
      ['Seguro e dinheiro jogado fora', 'Assim como o freio do carro, ate o dia em que nao e.'],
      ['Meu INSS cobre', 'Compare o teto do beneficio com o seu padrao de vida atual. A diferenca e o tamanho do seu risco descoberto.']
    ],
    dadosParaChecar: ['Teto de beneficio do INSS vigente', 'Dados de mercado segurador (SUSEP / CNseg)']
  },
  {
    id: 'consultoria',
    nome: 'Consultoria de Investimentos Alta Renda',
    prioridade: 2,
    dor: 'Tem patrimonio relevante espalhado em varias instituicoes, sem estrategia unica, pagando taxa que nao enxerga.',
    gatilho: 'Voce nao tem carteira. Voce tem uma colecao de produtos que alguem te vendeu em momentos diferentes.',
    publico: 'PF com patrimonio financeiro relevante; cliente de private mal atendido; quem recebeu heranca ou vendeu empresa.',
    ancoraTecnica: 'Diagnostico de alocacao, custo total real, aderencia ao objetivo e eficiencia tributaria.',
    ancoraMestre: 'bogle',
    ancoraMestreMotivo: 'Custo e o inimigo: o primeiro ganho de uma consultoria e quase sempre reduzir o custo invisivel.',
    ctaCurto: 'Se voce nao sabe dizer quanto paga de taxa por ano em reais, voce nao tem consultor - tem vendedor.',
    ctaLongo: 'Faz um teste comigo agora: abre o seu extrato e tenta achar, em reais, quanto voce pagou de taxa nos ultimos doze meses. Se voce nao conseguir achar em cinco minutos, esse e o problema. Nao e rentabilidade. E que voce nunca teve alguem do seu lado da mesa.',
    objecoes: [
      ['Meu gerente ja cuida disso', 'O gerente tem meta de produto. Pergunte a ele qual a meta dele neste trimestre.'],
      ['Meu patrimonio e pequeno', 'Entao o custo percentual pesa ainda mais. Escala nao protege quem paga caro.']
    ],
    dadosParaChecar: ['Selic e CDI vigentes', 'IPCA acumulado 12 meses', 'Regras de tributacao vigentes']
  },
  {
    id: 'sucessao',
    nome: 'Planejamento Sucessorio',
    prioridade: 2,
    dor: 'Patrimonio vai passar por inventario: custo, tempo e conflito familiar. Ninguem planejou.',
    gatilho: 'Inventario e o ultimo produto que a sua familia vai comprar de voce - e o mais caro.',
    publico: 'Familia empresaria; multiplos imoveis; segundo casamento; filhos de relacionamentos diferentes.',
    ancoraTecnica: 'ITCMD, custo e prazo de inventario, holding familiar, doacao em vida com usufruto, seguro de vida como liquidez sucessoria.',
    ancoraMestre: 'munger',
    ancoraMestreMotivo: 'Inversao: em vez de perguntar como transferir bem, pergunte tudo que faz uma familia brigar e perder patrimonio - e desative um por um.',
    ctaCurto: 'A sua familia vai herdar patrimonio ou vai herdar processo? Isso se decide agora, nao depois.',
    ctaLongo: 'Tem uma conta que quase ninguem faz: quanto custa, em dinheiro e em tempo, transferir o seu patrimonio do jeito que ele esta hoje. Some ITCMD, custas, honorarios e o tempo em que aquilo fica travado. Depois compare com o custo de estruturar isso em vida. Na maioria dos casos que eu vi, a diferenca paga a estrutura muitas vezes.',
    objecoes: [
      ['E cedo para isso', 'Sucessao nao e sobre idade. E sobre patrimonio existir.'],
      ['Minha familia se entende', 'Toda familia se entende ate o dia do inventario com prazo e imposto correndo.']
    ],
    dadosParaChecar: ['Aliquota de ITCMD do estado do cliente', 'Regras vigentes de tributacao de heranca e doacao']
  },
  {
    id: 'capitalgiro',
    nome: 'Capital de Giro PJ',
    prioridade: 2,
    dor: 'Empresa saudavel com descasamento de caixa, financiando operacao com o credito mais caro que existe.',
    gatilho: 'Sua empresa nao tem problema de lucro. Tem problema de ciclo de caixa - e esta pagando rotativo por isso.',
    publico: 'PJ com faturamento recorrente; comercio e servico com prazo de recebimento longo.',
    ancoraTecnica: 'Ciclo financeiro, custo do capital contra margem operacional, garantias que reduzem taxa.',
    ancoraMestre: 'kiyosaki',
    ancoraMestreMotivo: 'Divida que sustenta operacao geradora de caixa e divida boa - desde que o custo caiba na margem.',
    ctaCurto: 'Se o seu capital de giro esta no cartao ou no rotativo, o seu lucro esta indo embora por um cano que voce nem ve.',
    ctaLongo: 'Empresario, faz esse calculo: pega o seu prazo medio de recebimento, subtrai o de pagamento e multiplica pelo seu faturamento diario. Esse numero e quanto de dinheiro seu esta parado na rua. Se voce esta cobrindo isso com credito caro, a sua margem esta financiando o banco. Da para reestruturar - inclusive com garantia real, o que derruba a taxa.',
    objecoes: [
      ['Nao quero divida', 'Voce ja tem. So esta na modalidade mais cara.'],
      ['Meu banco nao aprova', 'Aprovacao e funcao de garantia e de apresentacao. As duas coisas se trabalham.']
    ],
    dadosParaChecar: ['Taxa media de capital de giro PJ (BCB)', 'Taxa media de rotativo e cartao PJ (BCB)']
  },
  {
    id: 'financiamento',
    nome: 'Financiamento Imobiliario',
    prioridade: 3,
    dor: 'Quer comprar imovel e nao sabe comparar CET, sistema de amortizacao e portabilidade.',
    gatilho: 'A diferenca entre SAC e Price no mesmo imovel pode ser o preco de um carro.',
    publico: 'Comprador de primeiro ou segundo imovel; investidor imobiliario.',
    ancoraTecnica: 'SAC x Price, CET real, portabilidade de divida, uso de FGTS.',
    ancoraMestre: 'bogle',
    ancoraMestreMotivo: 'Custo e o inimigo: a escolha de sistema e de taxa e o maior determinante do custo total.',
    ctaCurto: 'Voce nao compra imovel: voce compra o CET do contrato. Te mostro a diferenca.',
    ctaLongo: 'Duas pessoas compram o mesmo apartamento no mesmo dia e pagam valores totais muito diferentes. A diferenca nao esta no imovel - esta no sistema de amortizacao, na taxa e em quem negociou. Se voce ja tem financiamento, portabilidade e a conta mais rapida que existe.',
    objecoes: [['Ja fechei meu financiamento', 'Portabilidade existe justamente para isso.']],
    dadosParaChecar: ['Taxa media de financiamento imobiliario (BCB)', 'Regras vigentes de uso do FGTS']
  },
  {
    id: 'saude',
    nome: 'Convenio Medico e Saude',
    prioridade: 3,
    dor: 'Custo de saude sobe muito acima da inflacao geral e ninguem provisiona isso no plano de longo prazo.',
    gatilho: 'A inflacao medica nao e a inflacao do IPCA. E ela que vai comer sua aposentadoria.',
    publico: 'Familia; PJ que quer beneficio para reter time; pessoa acima de 50 anos.',
    ancoraTecnica: 'Variacao de custo medico-hospitalar contra IPCA; peso do plano no orcamento da aposentadoria.',
    ancoraMestre: 'graham',
    ancoraMestreMotivo: 'Margem de seguranca aplicada ao maior passivo silencioso da terceira idade.',
    ctaCurto: 'Voce planejou a aposentadoria com IPCA. Saude nao segue o IPCA. Refaz a conta comigo.',
    ctaLongo: 'Quando alguem me mostra um plano de aposentadoria, eu procuro uma linha que quase nunca esta la: o custo de saude aos 70, 75, 80 anos. Esse custo nao acompanha a inflacao geral - ele corre mais rapido. Um plano que ignora isso nao esta conservador, esta incompleto.',
    objecoes: [['Uso o SUS', 'Otimo como rede. O ponto e ter escolha quando o tempo de resposta importa.']],
    dadosParaChecar: ['Indice de reajuste de planos de saude (ANS)', 'IPCA acumulado 12 meses para comparacao']
  },
  {
    id: 'cartoes',
    nome: 'Cartoes e Estrutura de Beneficio',
    prioridade: 3,
    dor: 'Usa cartao como credito e nao como ferramenta; paga anuidade sem extrair beneficio; entra no rotativo.',
    gatilho: 'O rotativo do cartao e o credito mais caro do sistema financeiro brasileiro - e o mais usado.',
    publico: 'Alta renda que viaja; quem tem gasto recorrente alto; PJ com despesa de equipe.',
    ancoraTecnica: 'Taxa do rotativo contra qualquer outra modalidade; beneficio real contra anuidade.',
    ancoraMestre: 'kiyosaki',
    ancoraMestreMotivo: 'Divida ruim em estado puro: consumo financiado na modalidade mais cara disponivel.',
    ctaCurto: 'Cartao e ferramenta de fluxo, nao fonte de credito. Quem inverte isso paga a taxa mais cara do sistema.',
    ctaLongo: 'Cartao bom nao e o que tem o maior limite. E o que resolve fluxo de caixa e devolve beneficio maior que a anuidade. E se voce entrou no rotativo alguma vez nos ultimos doze meses, a prioridade nao e trocar de cartao - e trocar essa divida por uma modalidade decente.',
    objecoes: [['Pago tudo em dia', 'Entao voce e exatamente o perfil que deveria estar extraindo beneficio, e nao pagando anuidade a toa.']],
    dadosParaChecar: ['Taxa media do rotativo do cartao de credito (BCB)']
  }
];

/* -------------------------------------------------------------------------
   4. FORMULAS DE GANCHO (primeiros 3 segundos)
   ------------------------------------------------------------------------- */
const GANCHOS = [
  { id: 'contradicao', nome: 'Contradicao de Autoridade', molde: 'Todo mundo esta falando que [CONSENSO]. Os dados do [FONTE] dizem exatamente o contrario.' },
  { id: 'perda', nome: 'Perda Iminente', molde: 'Se voce tem [ATIVO/SITUACAO], voce tem ate [PRAZO] para entender isso. Depois disso a conta muda.' },
  { id: 'numero', nome: 'Numero Chocante', molde: '[NUMERO REAL] . Esse e o valor que [CONSEQUENCIA]. E quase ninguem esta olhando para isso.' },
  { id: 'confissao', nome: 'Confissao de Bastidor', molde: 'Dez anos atendendo alta renda em banco me ensinaram uma coisa que nenhum gerente vai te falar: [VERDADE].' },
  { id: 'erro', nome: 'Erro do Espectador', molde: 'Voce esta fazendo [ACAO COMUM] achando que e seguro. E o mais caro que existe hoje.' },
  { id: 'mestre', nome: 'Ancoragem no Mestre', molde: '[MESTRE] avisou sobre isso em [ANO/OBRA]. O Brasil de hoje esta vivendo o exemplo.' },
  { id: 'pergunta', nome: 'Pergunta Impossivel', molde: 'Quanto voce pagou de taxa em reais nos ultimos 12 meses? Se voce nao sabe, esse video e para voce.' },
  { id: 'inversao', nome: 'Inversao Contraintuitiva', molde: 'Todo mundo quer [OBJETIVO]. O caminho mais rapido e fazer o oposto: [ANTITESE].' }
];

/* -------------------------------------------------------------------------
   5. COMPLIANCE - blindagem do registro CEA/ANCORD
   ------------------------------------------------------------------------- */
const COMPLIANCE = {
  regrasParaIA: [
    'NUNCA recomendar compra ou venda de ativo especifico com nome e codigo.',
    'NUNCA prometer, projetar ou sugerir rentabilidade futura.',
    'NUNCA usar expressoes como "garantido", "sem risco", "vai subir", "oportunidade unica".',
    'Falar de CLASSES de ativo e de CONCEITOS, nao de recomendacao personalizada.',
    'Todo CTA e convite a diagnostico/consultoria - jamais oferta de ativo.',
    'Rentabilidade passada citada precisa vir com o aviso de que nao representa garantia futura.'
  ],
  disclaimerCurto: 'Conteudo educacional. Nao e recomendacao de investimento. Rentabilidade passada nao garante resultado futuro.',
  disclaimerLongo: 'Este conteudo tem carater exclusivamente educacional e informativo e nao constitui recomendacao, oferta ou solicitacao de compra ou venda de qualquer ativo ou produto financeiro. As analises apresentadas nao consideram objetivos de investimento, situacao financeira ou necessidades especificas de qualquer pessoa. Rentabilidade passada nao representa garantia de rentabilidade futura. Antes de investir, avalie seu perfil e leia a documentacao dos produtos. Consulte um profissional certificado para orientacao adequada ao seu caso.'
};

/* -------------------------------------------------------------------------
   6. FORMATOS DE VIDEO
   ------------------------------------------------------------------------- */
const FORMATOS = {
  short: {
    nome: 'Short / Reel / TikTok',
    duracao: '45 a 60 segundos',
    palavras: 'aprox. 120 a 160 palavras',
    estrutura: 'Gancho (0-3s) > Tensao (3-15s) > Dado que prova (15-35s) > Virada (35-50s) > CTA (50-60s)',
    regraRetencao: 'Corte seco a cada 2-4 segundos. Zero introducao. Zero "fala galera". Primeira palavra ja e o gancho.'
  },
  longo: {
    nome: 'YouTube Longo',
    duracao: '8 a 14 minutos',
    palavras: 'aprox. 1200 a 2000 palavras',
    estrutura: 'Cold open (0-30s) > Promessa (30-60s) > Contexto/dado (1-4min) > Ancoragem no mestre (4-6min) > Aplicacao pratica (6-10min) > CTA consultivo (10-12min) > Fechamento com proximo passo',
    regraRetencao: 'Loop aberto no cold open que so fecha no minuto 9. B-roll a cada 20s. Mudanca de enquadramento a cada 45s.'
  }
};

if (typeof window !== 'undefined') {
  window.KB = { MESTRES, INFLUENCIADORES, PRODUTOS, GANCHOS, COMPLIANCE, FORMATOS };
}
