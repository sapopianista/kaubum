'use strict';
/**
 * SCRIPT DE SIMULAÇÃO DE TRÁFEGO CONTÍNUO (Blue Team Lab)
 * Atende à anotação da lousa:
 * "script: adicionar: usuario, produto, transacao +/- a cada minuto"
 *
 * Gera tráfego de produção realista:
 * 1. Cria um novo usuário com dados válidos
 * 2. Faz login na conta
 * 3. Cadastra um produto novo no marketplace
 * 4. Realiza uma transação/compra no checkout com cálculo de frete
 * 5. Repete a cada ~60 segundos
 */

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:3000';
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 60000;

function genCPF() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9));
  let d1 = n.reduce((acc, val, i) => acc + val * (10 - i), 0);
  d1 = ((d1 * 10) % 11) % 10;
  let d2 = [...n, d1].reduce((acc, val, i) => acc + val * (11 - i), 0);
  d2 = ((d2 * 10) % 11) % 10;
  return [...n, d1, d2].join('');
}

const FIRST_NAMES = ['Lucas', 'Arthur', 'Beatriz', 'Carlos', 'Mariana', 'Gabriel', 'Juliana', 'Rafael', 'Fernanda', 'Rodrigo'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes'];
const PRODUCTS = [
  { nome: 'Bloco Adesivo para Anotações 400fls', preco: 28.9, cat: 'Papelaria', desc: 'Conjunto com 4 blocos autoadesivos reposicionáveis 76x76mm.' },
  { nome: 'Mousepad Ergonômico com Apoio em Gel', preco: 54.0, cat: 'Informática', desc: 'Base emborrachada antiderrapante e descanso de pulso macio.' },
  { nome: 'Adaptador Rede USB Gigabit Ethernet', preco: 79.0, cat: 'Periféricos', desc: 'Conexão RJ45 10/100/1000 Mbps via porta USB 3.0.' },
  { nome: 'Suporte Articulado de Mesa para Notebook', preco: 139.9, cat: 'Mobiliário', desc: 'Estrutura em alumínio anodizado para notebooks de 11 a 17 polegadas.' },
  { nome: 'Calculadora de Mesa 12 Dígitos Solar', preco: 42.5, cat: 'Eletrônicos', desc: 'Visor amplo inclinado com dupla alimentação solar e bateria.' }
];

async function runCycle(cycleNum) {
  const jar = new Map();

  function updateCookies(res) {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (v) jar.set(k, v);
        else jar.delete(k);
      }
    }
  }

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const ck = cookieHeader();
    if (ck) headers.Cookie = ck;
    if (jar.has('csrf')) headers['X-CSRF-Token'] = jar.get('csrf');
    const res = await fetch(TARGET_URL + '/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    updateCookies(res);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    return data;
  }

  console.log(`\n--------------------------------------------------`);
  console.log(`[CICLO #${cycleNum}] Iniciando atividade simulada (${new Date().toLocaleTimeString('pt-BR')})`);

  // 1. Obter cookie CSRF inicial
  const cat = await api('/produtos');
  const availableProducts = cat.produtos || [];

  // 2. Adicionar Usuário
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const fullName = `${firstName} ${lastName}`;
  const email = `aluno.${Date.now()}.${Math.floor(Math.random() * 1000)}@lab.ifsp`;
  const password = `AlunoSeguranca#${Math.floor(Math.random() * 900 + 100)}`;

  await api('/register', {
    method: 'POST',
    body: {
      nome: fullName,
      email,
      senha: password,
      cpf: genCPF(),
      telefone: `119${Math.floor(Math.random() * 90000000 + 10000000)}`,
      endereco: {
        cep: '01001000',
        rua: 'Rua do Laboratório',
        numero: String(Math.floor(Math.random() * 900 + 10)),
        complemento: 'Sala 211',
        bairro: 'Centro',
        cidade: 'São Paulo',
        uf: 'SP'
      }
    }
  });
  console.log(` [1/3] Usuário criado: ${fullName} (${email})`);

  // 3. Fazer Login
  await api('/login', { method: 'POST', body: { email, senha: password } });
  console.log(` [2/3] Login efetuado com sucesso.`);

  // 4. Adicionar Produto
  const prodTemplate = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const prodName = `${prodTemplate.nome} v${cycleNum}`;
  const prodRes = await api('/produtos', {
    method: 'POST',
    body: {
      nome: prodName,
      preco: prodTemplate.preco,
      categoria: prodTemplate.cat,
      estoque: Math.floor(Math.random() * 15 + 5),
      descricao: prodTemplate.desc,
      imagem_url: 'https://images.unsplash.com/photo-1595225476474-87563907a212?w=600&q=80'
    }
  });
  console.log(` [3/3] Produto cadastrado: "${prodName}" (ID #${prodRes.id})`);

  // 5. Realizar Transação / Compra (Checkout)
  const targetProd = availableProducts.length > 0 ? availableProducts[0] : { id: 1 };
  const orderRes = await api('/checkout', {
    method: 'POST',
    body: {
      itens: [{ id: targetProd.id, quantidade: 1 }],
      cvv: '987',
      cartao: {
        numero: '4532015112830366',
        validade: '12/30',
        titular: fullName.toUpperCase()
      }
    }
  });
  console.log(` [OK] Transação concluída: Pedido #${orderRes.id} de R$ ${orderRes.total.toFixed(2)}`);
}

async function start() {
  console.log('==================================================');
  console.log(' SIMULADOR DE ATIVIDADE CONTÍNUA KAUBUM');
  console.log(` Alvo: ${TARGET_URL}`);
  console.log(` Intervalo: ${INTERVAL_MS / 1000}s`);
  console.log('==================================================');

  let cycle = 1;
  const loop = async () => {
    try {
      await runCycle(cycle++);
    } catch (err) {
      console.error(` [ERRO NO CICLO] ${err.message}`);
    }
  };

  await loop();
  setInterval(loop, INTERVAL_MS);
}

start();

