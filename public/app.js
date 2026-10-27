(() => {
'use strict';
/* Toda renderização usa h() + textContent/createTextNode: nunca innerHTML com dados de usuário (A03). */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = d => (RM ? 0 : d);
const BRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const normStr = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const VIEWS = ['catalogo', 'carrinho', 'conta', 'vender', 'seguranca'];

const S = {
  view: 'catalogo',
  accountTab: 'perfil', // 'perfil' | 'pedidos' (logado) ou 'login' | 'register' | 'forgot' | 'reset' (visitante)
  products: [],
  cat: 'Todos',
  query: '',
  sort: 'relevancia',
  cart: new Map(),
  uf: 'SP',
  user: null,
  profile: null
};

try {
  for (const [k, v] of JSON.parse(sessionStorage.getItem('cart') || '[]'))
    if (Number.isInteger(k) && Number.isInteger(v) && v > 0) S.cart.set(k, v);
} catch { /* carrinho corrompido: ignora */ }
const saveCart = () => sessionStorage.setItem('cart', JSON.stringify([...S.cart]));
const items = () => [...S.cart].map(([id, q]) => ({ id, quantidade: q }));

/* ------------------------------ API ------------------------------ */
const csrfToken = () => (document.cookie.split('; ').find(c => c.startsWith('csrf=')) || '').slice(5);
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
    body: body ? JSON.stringify(body) : undefined
  });
  let d = {};
  try { d = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = new Error(d.erro || 'Erro inesperado'); e.status = r.status; throw e; }
  return d;
}

/* --------------------- Notificações Acessíveis (Toasts) --------------------- */
function toast(msg, bad) {
  const region = $('#toast-region') || document.body;
  let timer = null;
  const removeToast = () => {
    clearTimeout(timer);
    gsap.to(t, { opacity: 0, y: 8, duration: dur(.25), onComplete: () => t.remove() });
  };
  const closeBtn = h('button', {
    type: 'button',
    class: 'toast-close',
    'aria-label': 'Fechar notificação',
    onclick: removeToast
  }, h('span', { 'aria-hidden': 'true' }, '×'));

  const t = h('div', {
    class: 'toast' + (bad ? ' bad' : ''),
    role: bad ? 'alert' : 'status',
    onmouseenter: () => clearTimeout(timer),
    onmouseleave: () => { timer = setTimeout(removeToast, 3500); },
    onfocusin: () => clearTimeout(timer),
    onfocusout: () => { timer = setTimeout(removeToast, 3500); }
  }, h('span', {}, msg), closeBtn);

  region.append(t);
  gsap.fromTo(t, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: dur(.3) });
  timer = setTimeout(removeToast, 5000);
}

/* --------------------- Navegação entre Telas/Abas (SPA Acessível) --------------------- */
function switchView(viewName, { focusMain = false, subTab = null } = {}) {
  if (!VIEWS.includes(viewName)) viewName = 'catalogo';
  S.view = viewName;
  if (subTab) S.accountTab = subTab;

  for (const btn of $$('#main-tabs .nav-tab')) {
    const active = btn.dataset.view === viewName;
    btn.classList.toggle('on', active);
    btn.setAttribute('aria-selected', String(active));
    btn.setAttribute('tabindex', active ? '0' : '-1');
  }

  for (const v of VIEWS) {
    const panel = $(`#view-${v}`);
    if (!panel) continue;
    const isTarget = v === viewName;
    panel.hidden = !isTarget;
    panel.classList.toggle('active', isTarget);
    if (isTarget) {
      gsap.fromTo(panel, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: dur(.3), ease: 'power2.out' });
    }
  }

  if (viewName === 'catalogo') renderGrid(false);
  else if (viewName === 'carrinho') renderCartScreen();
  else if (viewName === 'conta') renderAccountScreen();
  else if (viewName === 'vender') renderVenderScreen();
  else if (viewName === 'seguranca') renderSegurancaScreen();

  if (focusMain) {
    const mainEl = $('#main-content');
    if (mainEl) mainEl.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
}

// Eventos nas abas superiores + Setas do teclado (WAI-ARIA Tabs Pattern)
$('#main-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.nav-tab');
  if (btn && btn.dataset.view) switchView(btn.dataset.view);
});

$('#main-tabs').addEventListener('keydown', e => {
  const tabs = $$('#main-tabs .nav-tab');
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;
  let nextIdx = -1;
  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = tabs.length - 1;
  if (nextIdx !== -1) {
    e.preventDefault();
    tabs[nextIdx].focus();
    switchView(tabs[nextIdx].dataset.view);
  }
});

// Atalhos globais de teclado (Alt+1..5 e / para busca)
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    const targetView = VIEWS[Number(e.key) - 1];
    switchView(targetView, { focusMain: true });
    return;
  }
  if (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      e.preventDefault();
      if (S.view !== 'catalogo') switchView('catalogo');
      const sInp = $('#search-input');
      if (sInp) sInp.focus();
    }
  }
});

$('#brand-link').addEventListener('click', e => {
  e.preventDefault();
  switchView('catalogo');
});
$('#btn-cart').addEventListener('click', () => switchView('carrinho', { focusMain: true }));
$('#btn-account').addEventListener('click', () => {
  switchView('conta', { focusMain: true, subTab: S.user ? 'perfil' : 'login' });
});

/* ------------------------------ TELA 1: CATÁLOGO & VITRINE ------------------------------ */
function renderChips() {
  const cats = ['Todos', ...new Set(S.products.map(p => p.categoria))];
  $('#chips').replaceChildren(...cats.map(c => h('button', {
    type: 'button',
    class: 'chip' + (c === S.cat ? ' on' : ''),
    'aria-pressed': String(c === S.cat),
    onclick: () => { S.cat = c; renderChips(); renderGrid(true); }
  }, c)));
}

function thumb(p) {
  const t = h('div', { class: 'thumb' });
  t.style.setProperty('--h', String(205 + ((p.id || 1) % 6) * 9));
  const mono = () => t.replaceChildren(h('span', { class: 'mono', 'aria-hidden': 'true' }, ((p.nome && p.nome[0]) || '?').toUpperCase()));
  if (typeof p.imagem_url === 'string' && p.imagem_url.startsWith('https://')) {
    const img = h('img', { src: p.imagem_url, alt: `Foto de ${p.nome}`, loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', mono);
    t.append(img);
  } else mono();
  return t;
}

function card(p, isPreview = false) {
  const outOfStock = p.estoque < 1;
  return h('article', { class: 'card' }, thumb(p),
    h('div', { class: 'cbody' },
      h('span', { class: 'cat' }, p.categoria || 'Categoria'),
      h('h3', {}, p.nome || 'Nome do produto'),
      h('p', {}, p.descricao || 'Descrição detalhada do item.'),
      h('div', { class: 'cfoot' },
        h('div', {},
          h('div', { class: 'price' }, BRL(p.preco)),
          p.estoque > 0 && p.estoque <= 5 ? h('div', { class: 'low' }, `Restam ${p.estoque} un.`) : null
        ),
        isPreview
          ? h('span', { class: 'pill' }, 'Pré-visualização')
          : h('button', {
              type: 'button',
              class: 'btn pri',
              disabled: outOfStock ? 'true' : null,
              'aria-label': outOfStock ? `${p.nome} esgotado` : `Adicionar ${p.nome} ao carrinho`,
              onclick: () => addToCart(p.id)
            }, outOfStock ? 'Esgotado' : 'Adicionar'))));
}

function getFilteredProducts() {
  const q = normStr(S.query.trim());
  let list = S.products.filter(p => {
    const matchCat = S.cat === 'Todos' || p.categoria === S.cat;
    if (!matchCat) return false;
    if (!q) return true;
    return normStr(p.nome).includes(q) || normStr(p.descricao).includes(q) || normStr(p.categoria).includes(q);
  });
  if (S.sort === 'menor-preco') list = [...list].sort((a, b) => a.preco - b.preco);
  else if (S.sort === 'maior-preco') list = [...list].sort((a, b) => b.preco - a.preco);
  else if (S.sort === 'nome-az') list = [...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return list;
}

function renderGrid(anim) {
  const grid = $('#grid');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'false');
  const list = getFilteredProducts();
  const countEl = $('#results-count');
  if (countEl) {
    countEl.textContent = `${list.length} ${list.length === 1 ? 'item exibido' : 'itens exibidos'}`;
  }

  if (!list.length) {
    grid.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', {}, 'Nenhum item corresponde aos filtros'),
        h('p', { class: 'mute' }, 'Tente buscar por outro termo ou redefinir a categoria selecionada.'),
        h('button', {
          type: 'button',
          class: 'btn pri',
          onclick: () => {
            S.cat = 'Todos';
            S.query = '';
            S.sort = 'relevancia';
            if ($('#search-input')) $('#search-input').value = '';
            if ($('#search-clear')) $('#search-clear').hidden = true;
            if ($('#sort-select')) $('#sort-select').value = 'relevancia';
            renderChips();
            renderGrid(true);
          }
        }, 'Redefinir filtros'))
    );
    return;
  }

  grid.replaceChildren(...list.map(p => card(p, false)));
  if (anim) gsap.from('#grid > .card', { y: 18, opacity: 0, duration: dur(.4), stagger: RM ? 0 : .04, ease: 'power2.out' });
}

async function loadProducts() {
  S.products = (await api('/produtos')).produtos;
  for (const id of [...S.cart.keys()]) if (!S.products.some(p => p.id === id)) S.cart.delete(id);
  saveCart(); updateCount();
}

const searchInput = $('#search-input');
const searchClear = $('#search-clear');
const sortSelect = $('#sort-select');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    S.query = searchInput.value;
    if (searchClear) searchClear.hidden = !S.query;
    renderGrid(false);
  });
}
if (searchClear) {
  searchClear.addEventListener('click', () => {
    S.query = '';
    if (searchInput) { searchInput.value = ''; searchInput.focus(); }
    searchClear.hidden = true;
    renderGrid(true);
  });
}
if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    S.sort = sortSelect.value;
    renderGrid(true);
  });
}

/* ------------------------------ TELA 2: CARRINHO & CHECKOUT ------------------------------ */
const updateCount = () => {
  const totalQty = [...S.cart.values()].reduce((a, b) => a + b, 0);
  if ($('#cart-count')) $('#cart-count').textContent = totalQty;
  if ($('#nav-cart-badge')) $('#nav-cart-badge').textContent = totalQty;
};

function addToCart(id) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const cur = S.cart.get(id) || 0;
  if (cur + 1 > Math.min(20, p.estoque)) return toast('Quantidade máxima disponível atingida', true);
  S.cart.set(id, cur + 1); saveCart(); updateCount();
  toast(`${p.nome} adicionado ao carrinho`);
  gsap.fromTo('#btn-cart', { scale: 1.08 }, { scale: 1, duration: dur(.35) });
}

function setQty(id, q) {
  const p = S.products.find(x => x.id === id);
  if (q < 1) S.cart.delete(id); else S.cart.set(id, Math.min(q, 20, p ? p.estoque : 1));
  saveCart(); updateCount();
  if (S.view === 'carrinho') renderCartScreen();
}

/* Helpers de formulário Acessíveis */
let fieldSeq = 0;
const fd = f => Object.fromEntries(new FormData(f));

const field = (name, label, type = 'text', extra = {}) => {
  const id = `fld-${++fieldSeq}-${name}`;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, name, type, ...extra }));
};

const area = (name, label, extra = {}) => {
  const id = `fld-${++fieldSeq}-${name}`;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('textarea', { id, name, rows: 3, maxlength: 500, ...extra }));
};

const ADDR = [
  ['cep', 'CEP', { inputmode: 'numeric', maxlength: 9, placeholder: '00000-000' }],
  ['rua', 'Rua / Logradouro', { maxlength: 80 }],
  ['numero', 'Número', { maxlength: 10 }],
  ['complemento', 'Complemento (opcional)', { maxlength: 40 }],
  ['bairro', 'Bairro', { maxlength: 60 }],
  ['cidade', 'Cidade', { maxlength: 60 }],
  ['uf', 'UF', { maxlength: 2, placeholder: 'SP' }]
];

const addrFields = (v = {}, required = true) =>
  ADDR.map(([k, l, ext]) =>
    field('end_' + k, l, 'text', {
      value: v[k] || '',
      ...ext,
      ...(k === 'complemento' || !required ? {} : { required: 'true' })
    })
  );

const readAddr = d => Object.fromEntries(ADDR.map(([k]) => [k, d['end_' + k] || '']));
const fmtAddr = a => a ? `${a.rua}, ${a.numero}${a.complemento ? ' ' + a.complemento : ''} — ${a.bairro}, ${a.cidade}/${a.uf} — CEP ${a.cep}` : 'Não cadastrado';

const submit = (errEl, fn) => async e => {
  e.preventDefault();
  const form = e.target;
  if (!errEl.id) errEl.id = `err-${++fieldSeq}`;
  errEl.textContent = '';
  form.querySelectorAll('[aria-invalid]').forEach(inp => inp.removeAttribute('aria-invalid'));

  const btn = e.submitter || form.querySelector('button[type="submit"]');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.dataset.loading = 'true';
  }
  try {
    await fn(fd(form), form);
  } catch (x) {
    errEl.textContent = x.message;
    form.querySelectorAll('input, textarea, select').forEach(inp => inp.setAttribute('aria-describedby', errEl.id));
  } finally {
    if (btn) {
      btn.disabled = false;
      delete btn.dataset.loading;
      if (origText && btn.isConnected) btn.textContent = origText;
    }
  }
};

async function renderCartScreen() {
  const container = $('#cart-screen-content');
  if (!container) return;

  if (!S.cart.size) {
    container.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', {}, 'Seu carrinho está vazio'),
        h('p', { class: 'mute' }, 'Adicione itens na aba Catálogo para simular o frete e concluir seu pedido.'),
        h('button', { type: 'button', class: 'btn pri', onclick: () => switchView('catalogo', { focusMain: true }) }, 'Ir para o Catálogo'))
    );
    return;
  }

  // Coluna 1: Lista de itens
  const itemsBox = h('div', { class: 'panel-surface' },
    h('h2', {}, '1. Itens Selecionados'),
    ...[...S.cart].map(([id, q]) => {
      const p = S.products.find(x => x.id === id);
      if (!p) return null;
      return h('div', { class: 'row' },
        h('div', {},
          h('strong', {}, p.nome),
          h('div', { class: 'mute' }, `${BRL(p.preco)} un. · Subtotal: ${BRL(p.preco * q)}`)
        ),
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': `Diminuir quantidade de ${p.nome}`, onclick: () => setQty(id, q - 1) }, '−'),
          h('span', { 'aria-live': 'polite' }, q),
          h('button', { type: 'button', 'aria-label': `Aumentar quantidade de ${p.nome}`, onclick: () => setQty(id, q + 1) }, '+')));
    }),
    h('div', { class: 'links' },
      h('button', { type: 'button', class: 'btn', onclick: () => switchView('catalogo') }, '← Continuar comprando'),
      h('button', { type: 'button', class: 'btn', onclick: () => { S.cart.clear(); saveCart(); updateCount(); renderCartScreen(); } }, 'Esvaziar carrinho')
    )
  );

  // Coluna 2: Frete + Checkout
  const checkoutBox = h('div', { class: 'panel-surface' }, h('p', { class: 'mute' }, 'Calculando cotação no servidor…'));
  container.replaceChildren(itemsBox, checkoutBox);

  const p = S.profile || {};
  const hasAddr = Boolean(p.endereco && p.endereco.cep);
  const hasCard = Boolean(p.cartao && p.cartao.mascara);
  const activeUf = hasAddr ? p.endereco.uf : (S.uf || 'SP');

  try {
    const t = await api('/cotacao', { method: 'POST', body: { itens: items(), uf: activeUf } });
    const ufSelect = h('select', {
      'aria-label': 'Selecionar UF para cálculo de frete',
      onchange: e => { S.uf = e.target.value; renderCartScreen(); }
    }, ...UFS.map(u => h('option', { value: u, selected: u === activeUf ? 'selected' : null }, u)));

    const err = h('p', { class: 'err', role: 'alert' });

    let authOrPayContent;
    if (!S.user) {
      authOrPayContent = h('div', { class: 'order' },
        h('strong', {}, 'Identificação necessária para concluir'),
        h('p', { class: 'mute' }, 'Para finalizar a compra com segurança, acesse sua conta ou cadastre-se.'),
        h('div', { class: 'two' },
          h('button', { type: 'button', class: 'btn pri', onclick: () => switchView('conta', { focusMain: true, subTab: 'login' }) }, 'Entrar na Conta'),
          h('button', { type: 'button', class: 'btn', onclick: () => switchView('conta', { focusMain: true, subTab: 'register' }) }, 'Criar Conta')
        )
      );
    } else {
      const summaryItems = [];
      if (hasAddr) summaryItems.push(h('dt', {}, 'Entrega'), h('dd', {}, fmtAddr(p.endereco)));
      if (hasCard) summaryItems.push(h('dt', {}, 'Cartão salvo'), h('dd', {}, `${p.cartao.mascara} · ${p.cartao.titular}`));

      const extraFields = [];
      if (!hasAddr) {
        extraFields.push(
          h('h3', { class: 'sub' }, 'Endereço de Entrega'),
          h('div', { class: 'two' }, addrFields({}, true))
        );
      }
      if (!hasCard) {
        extraFields.push(
          h('h3', { class: 'sub' }, 'Cartão de Crédito para Pagamento'),
          field('c_numero', 'Número do cartão (validado via Luhn)', 'text', { required: 'true', inputmode: 'numeric', maxlength: 23, autocomplete: 'cc-number' }),
          h('div', { class: 'two' },
            field('c_validade', 'Validade (MM/AA)', 'text', { required: 'true', maxlength: 5, placeholder: '12/30', autocomplete: 'cc-exp' }),
            field('c_titular', 'Nome impresso no cartão', 'text', { required: 'true', maxlength: 60, autocomplete: 'cc-name' })
          )
        );
      }

      authOrPayContent = h('form', { onsubmit: submit(err, async d => {
        const payload = { itens: items(), cvv: d.cvv };
        if (!hasAddr) payload.endereco = readAddr(d);
        if (!hasCard) payload.cartao = { numero: d.c_numero, validade: d.c_validade, titular: d.c_titular };
        const r = await api('/checkout', { method: 'POST', body: payload });
        S.cart.clear(); saveCart(); updateCount();
        await loadProducts(); await loadProfile();
        toast(`Pedido #${r.id} confirmado com sucesso!`);
        switchView('conta', { focusMain: true, subTab: 'pedidos' });
      }) },
        summaryItems.length ? h('dl', { class: 'kv' }, ...summaryItems) : null,
        ...extraFields,
        field('cvv', 'Código de Segurança — CVV (validado e descartado na memória)', 'password', { required: 'true', inputmode: 'numeric', maxlength: 4, autocomplete: 'cc-csc' }),
        h('button', { class: 'btn pri block', type: 'submit' }, `Confirmar e Pagar ${BRL(t.total)}`),
        err
      );
    }

    checkoutBox.replaceChildren(
      h('h2', {}, '2. Resumo & Pagamento'),
      h('div', { class: 'sum' }, h('span', { class: 'mute' }, 'Subtotal dos itens'), h('span', {}, BRL(t.subtotal))),
      h('div', { class: 'sum' },
        h('span', { class: 'mute' }, 'Frete estimado (UF: ', ufSelect, ')'),
        h('span', {}, t.frete === 0 ? 'Grátis (compras ≥ R$ 300)' : BRL(t.frete))
      ),
      h('div', { class: 'sum total' }, h('span', {}, 'Total do Pedido'), h('span', {}, BRL(t.total))),
      authOrPayContent
    );
  } catch (e) {
    checkoutBox.replaceChildren(h('p', { class: 'err', role: 'alert' }, e.message));
  }
}

/* ------------------------------ TELA 3: MINHA CONTA (PERFIL, LOGIN E PEDIDOS) ------------------------------ */
function updateHeader() {
  const btn = $('#btn-account');
  const pill = $('#user-pill');
  if (S.user) {
    const first = S.user.split(' ')[0];
    btn.textContent = 'Minha Conta';
    pill.textContent = `Logado: ${first}`;
  } else {
    btn.textContent = 'Entrar / Cadastrar';
    pill.textContent = 'Visitante';
  }
}

async function loadProfile() {
  try {
    S.profile = await api('/perfil');
    if (S.profile && S.profile.endereco && S.profile.endereco.uf) S.uf = S.profile.endereco.uf;
  } catch { S.profile = null; }
}

async function afterAuth() {
  const s = await api('/sessao');
  S.user = s.logado ? s.nome : null;
  await loadProfile();
  updateHeader();
}

const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];

async function renderAccountScreen() {
  const subtabsEl = $('#account-subtabs');
  const box = $('#account-screen-content');
  const titleEl = $('#account-main-title');
  if (!subtabsEl || !box) return;

  if (!S.user) {
    if (!['login', 'register', 'forgot', 'reset'].includes(S.accountTab)) S.accountTab = 'login';
    const guestTabs = [
      ['login', 'Entrar na Conta'],
      ['register', 'Criar Nova Conta'],
      ['forgot', 'Recuperar Senha'],
      ['reset', 'Usar Token de Senha']
    ];
    if (titleEl) titleEl.textContent = dictTitle(S.accountTab);
    subtabsEl.replaceChildren(...guestTabs.map(([k, label]) => h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(S.accountTab === k),
      class: 'subtab' + (S.accountTab === k ? ' on' : ''),
      onclick: () => { S.accountTab = k; renderAccountScreen(); }
    }, label)));

    renderAuthForm(box, S.accountTab);
    return;
  }

  // Usuário autenticado
  if (!['perfil', 'pedidos'].includes(S.accountTab)) S.accountTab = 'perfil';
  if (titleEl) titleEl.textContent = `Olá, ${S.user}`;
  const userTabs = [
    ['perfil', 'Meus Dados Cadastrais (AES-256)'],
    ['pedidos', 'Histórico de Pedidos & Entregas']
  ];
  subtabsEl.replaceChildren(
    ...userTabs.map(([k, label]) => h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(S.accountTab === k),
      class: 'subtab' + (S.accountTab === k ? ' on' : ''),
      onclick: () => { S.accountTab = k; renderAccountScreen(); }
    }, label)),
    h('button', {
      type: 'button',
      class: 'btn',
      onclick: async () => {
        try { await api('/logout', { method: 'POST' }); } catch { /* ignora */ }
        S.user = null; S.profile = null; updateHeader();
        toast('Sessão encerrada com segurança');
        S.accountTab = 'login';
        renderAccountScreen();
      }
    }, 'Sair da Conta')
  );

  box.replaceChildren(h('p', { class: 'mute' }, 'Carregando informações seguras…'));
  try {
    if (S.accountTab === 'perfil') await renderPerfilSubtab(box);
    else await renderPedidosSubtab(box);
  } catch (e) {
    if (e.status === 401) {
      S.user = null; updateHeader(); S.accountTab = 'login'; renderAccountScreen();
    } else {
      box.replaceChildren(h('p', { class: 'err', role: 'alert' }, e.message));
    }
  }
}

function dictTitle(mode) {
  return {
    login: 'Acessar Conta',
    register: 'Cadastro de Novo Cliente',
    forgot: 'Recuperação de Senha',
    reset: 'Redefinir Senha com Token'
  }[mode] || 'Minha Conta';
}

function renderAuthForm(box, mode) {
  const err = h('p', { class: 'err', role: 'alert' });
  const link = (t, m) => h('button', { type: 'button', class: 'lnk', onclick: () => { S.accountTab = m; renderAccountScreen(); } }, t);

  if (mode === 'login') {
    box.replaceChildren(h('form', { onsubmit: submit(err, async d => {
      await api('/login', { method: 'POST', body: { email: d.email, senha: d.senha } });
      await afterAuth();
      toast('Sessão iniciada com sucesso');
      S.accountTab = 'perfil';
      renderAccountScreen();
    }) },
      h('p', { class: 'mute' }, 'Entre com seu e-mail e senha. Protegido contra força bruta (limite de 5 tentativas / 10 min).'),
      field('email', 'E-mail cadastrado', 'email', { autocomplete: 'username', required: 'true' }),
      field('senha', 'Senha', 'password', { autocomplete: 'current-password', required: 'true' }),
      h('button', { class: 'btn pri', type: 'submit' }, 'Entrar na Conta'),
      err,
      h('div', { class: 'links' }, link('Não tem conta? Cadastre-se', 'register'), link('Esqueci minha senha', 'forgot'))));
  } else if (mode === 'register') {
    box.replaceChildren(h('form', { onsubmit: submit(err, async d => {
      const r = await api('/register', {
        method: 'POST',
        body: { nome: d.nome, email: d.email, senha: d.senha, cpf: d.cpf, telefone: d.telefone, endereco: readAddr(d) }
      });
      toast(r.mensagem);
      S.accountTab = 'login';
      renderAccountScreen();
    }) },
      h('p', { class: 'mute' }, 'Seus documentos e endereço são cifrados com AES-256-GCM antes de gravar no MySQL.'),
      h('div', { class: 'two' },
        field('nome', 'Nome completo', 'text', { required: 'true', maxlength: 80, autocomplete: 'name' }),
        field('email', 'E-mail', 'email', { required: 'true', autocomplete: 'username' })
      ),
      field('senha', 'Senha forte (10 a 72 caracteres, com maiúscula, minúscula e número)', 'password', { required: 'true', minlength: 10, maxlength: 72, autocomplete: 'new-password' }),
      h('div', { class: 'two' },
        field('cpf', 'CPF (validado pelos dígitos verificadores)', 'text', { required: 'true', inputmode: 'numeric', maxlength: 14, placeholder: '000.000.000-00' }),
        field('telefone', 'Telefone com DDD', 'tel', { required: 'true', maxlength: 16, placeholder: '(11) 99999-9999' })
      ),
      h('h3', { class: 'sub' }, 'Endereço para Entrega'),
      h('div', { class: 'two' }, addrFields({}, true)),
      h('button', { class: 'btn pri', type: 'submit' }, 'Concluir Cadastro'),
      err,
      h('div', { class: 'links' }, link('Já possui cadastro? Entrar', 'login'))));
  } else if (mode === 'forgot') {
    box.replaceChildren(h('form', { onsubmit: submit(err, async d => {
      const r = await api('/forgot', { method: 'POST', body: { email: d.email } });
      toast(r.mensagem);
      S.accountTab = 'reset';
      renderAccountScreen();
    }) },
      h('p', { class: 'mute' }, 'Informe seu e-mail. Para fins didáticos da aula, o token de uso único será impresso no terminal do servidor.'),
      field('email', 'E-mail da conta', 'email', { required: 'true', autocomplete: 'username' }),
      h('button', { class: 'btn pri', type: 'submit' }, 'Gerar Token de Recuperação'),
      err,
      h('div', { class: 'links' }, link('Já copiei o token do terminal', 'reset'), link('Voltar ao login', 'login'))));
  } else {
    box.replaceChildren(h('form', { onsubmit: submit(err, async d => {
      const r = await api('/reset', { method: 'POST', body: { token: d.token.trim(), senha: d.senha } });
      toast(r.mensagem);
      S.accountTab = 'login';
      renderAccountScreen();
    }) },
      field('token', 'Token de 64 caracteres (gerado no terminal do servidor)', 'text', { required: 'true', maxlength: 64, autocomplete: 'off' }),
      field('senha', 'Nova senha (10+ caracteres, maiúscula, minúscula e número)', 'password', { required: 'true', minlength: 10, maxlength: 72, autocomplete: 'new-password' }),
      h('button', { class: 'btn pri', type: 'submit' }, 'Redefinir Senha'),
      err,
      h('div', { class: 'links' }, link('Voltar ao login', 'login'))));
  }
}

async function renderPerfilSubtab(box) {
  const p = await api('/perfil');
  S.profile = p;
  const err = h('p', { class: 'err', role: 'alert' });
  box.replaceChildren(
    h('h2', {}, 'Dados Armazenados (Mascarados pela API)'),
    h('dl', { class: 'kv' },
      kv('Nome', p.nome),
      kv('E-mail', p.email),
      kv('CPF', p.cpf || 'Não cadastrado'),
      kv('Telefone', p.telefone || 'Não cadastrado'),
      kv('Endereço', fmtAddr(p.endereco)),
      kv('Cartão', p.cartao ? `${p.cartao.mascara} · ${p.cartao.titular} (Val: ${p.cartao.validade})` : 'Não cadastrado')
    ),
    h('h3', { class: 'sub' }, 'Atualizar Cadastro e Cartão (campos em branco mantêm o valor atual)'),
    h('form', { onsubmit: submit(err, async d => {
      await api('/perfil', {
        method: 'PUT',
        body: {
          cpf: d.cpf,
          telefone: d.telefone,
          endereco: readAddr(d),
          cartao: { numero: d.c_numero, validade: d.c_validade, titular: d.c_titular }
        }
      });
      toast('Dados atualizados e recifrados com sucesso');
      await renderPerfilSubtab(box);
    }) },
      h('div', { class: 'two' },
        field('cpf', 'Novo CPF (opcional)', 'text', { inputmode: 'numeric', maxlength: 14 }),
        field('telefone', 'Novo Telefone (opcional)', 'tel', { maxlength: 16 })
      ),
      h('div', { class: 'two' }, addrFields(p.endereco || {}, false)),
      h('h3', { class: 'sub' }, 'Cartão de Crédito'),
      field('c_numero', 'Número do cartão (validado via algoritmo de Luhn)', 'text', { inputmode: 'numeric', maxlength: 23, autocomplete: 'cc-number' }),
      h('div', { class: 'two' },
        field('c_validade', 'Validade (MM/AA)', 'text', { maxlength: 5, placeholder: '12/30', autocomplete: 'cc-exp' }),
        field('c_titular', 'Nome do titular', 'text', { maxlength: 60, autocomplete: 'cc-name' })
      ),
      h('button', { class: 'btn pri', type: 'submit' }, 'Salvar Alterações'),
      err)
  );
}

async function renderPedidosSubtab(box) {
  const { pedidos } = await api('/pedidos');
  if (!pedidos.length) {
    box.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', {}, 'Você ainda não realizou pedidos'),
        h('p', { class: 'mute' }, 'Assim que concluir uma compra, o histórico e o rastreamento aparecerão aqui.'),
        h('button', { type: 'button', class: 'btn pri', onclick: () => switchView('catalogo') }, 'Explorar Catálogo'))
    );
    return;
  }
  box.replaceChildren(
    h('h2', {}, 'Meus Pedidos Realizados'),
    ...pedidos.map(o => {
      const det = h('div', {});
      return h('div', { class: 'order' },
        h('div', { class: 'sum' }, h('strong', {}, `Pedido #${o.id}`), h('span', { class: 'pill' }, o.status)),
        h('div', { class: 'sum mute' }, h('span', {}, `Data: ${new Date(o.data).toLocaleString('pt-BR')}`), h('strong', {}, BRL(o.total))),
        h('button', {
          type: 'button',
          class: 'lnk',
          onclick: async () => {
            try {
              const d = await api('/pedidos/' + o.id);
              det.replaceChildren(
                ...d.itens.map(i => h('div', { class: 'sum' }, h('span', {}, `${i.quantidade}× ${i.nome}`), h('span', {}, BRL(i.unitario * i.quantidade)))),
                h('div', { class: 'sum mute' }, h('span', {}, 'Frete'), h('span', {}, d.frete === 0 ? 'Grátis' : BRL(d.frete))),
                h('p', { class: 'mute' }, 'Endereço de entrega: ' + fmtAddr(d.endereco))
              );
            } catch (e) {
              det.replaceChildren(h('p', { class: 'err' }, e.message));
            }
          }
        }, 'Inspecionar itens e endereço de entrega'),
        det
      );
    })
  );
}

/* ------------------------------ TELA 4: CENTRAL DE VENDAS (COM LIVE PREVIEW) ------------------------------ */
function renderVenderScreen() {
  const container = $('#vender-screen-content');
  if (!container) return;

  if (!S.user) {
    container.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', {}, 'Autenticação necessária para anunciar produtos'),
        h('p', { class: 'mute' }, 'Apenas usuários autenticados podem publicar novos itens no catálogo do marketplace.'),
        h('button', { type: 'button', class: 'btn pri', onclick: () => switchView('conta', { focusMain: true, subTab: 'login' }) }, 'Entrar na Minha Conta'))
    );
    return;
  }

  const err = h('p', { class: 'err', role: 'alert' });
  const previewHolder = h('div', {});

  const updatePreview = formEl => {
    const d = formEl ? fd(formEl) : {};
    const p = {
      id: 999,
      nome: d.nome || 'Exemplo de Suprimento Corporativo',
      preco: Number(String(d.preco || '99.90').replace(',', '.')) || 99.9,
      categoria: d.categoria || 'Informática',
      estoque: d.estoque !== '' && d.estoque != null ? Number(d.estoque) : 10,
      descricao: d.descricao || 'A descrição do seu produto aparecerá aqui conforme você digita no formulário ao lado.',
      imagem_url: d.imagem_url || ''
    };
    previewHolder.replaceChildren(card(p, true));
  };

  const formEl = h('form', {
    oninput: e => updatePreview(e.currentTarget),
    onsubmit: submit(err, async (d, f) => {
      await api('/produtos', {
        method: 'POST',
        body: {
          nome: d.nome,
          preco: Number(String(d.preco).replace(',', '.')),
          categoria: d.categoria,
          estoque: Number(d.estoque),
          descricao: d.descricao,
          imagem_url: d.imagem_url
        }
      });
      f.reset();
      updatePreview(f);
      await loadProducts();
      renderChips();
      toast('Produto publicado com sucesso no catálogo!');
      switchView('catalogo', { focusMain: true });
    })
  },
    h('h2', {}, 'Dados do Novo Produto'),
    field('nome', 'Título do produto (3 a 80 caracteres)', 'text', { required: 'true', maxlength: 80, placeholder: 'Ex.: Suporte Articulado de Mesa' }),
    h('div', { class: 'two' },
      field('preco', 'Preço unitário (R$)', 'text', { required: 'true', inputmode: 'decimal', placeholder: '89,90' }),
      field('estoque', 'Quantidade em estoque', 'number', { required: 'true', min: 0, max: 9999, step: 1, value: '10' })
    ),
    field('categoria', 'Categoria (ex.: Informática, Papelaria, Mobiliário)', 'text', { required: 'true', maxlength: 30, placeholder: 'Informática' }),
    area('descricao', 'Descrição técnica (até 500 caracteres)', { placeholder: 'Descreva especificações, dimensões e compatibilidade.' }),
    field('imagem_url', 'URL da foto (https://, opcional)', 'url', { maxlength: 400, placeholder: 'https://images.unsplash.com/...' }),
    h('button', { class: 'btn pri', type: 'submit' }, 'Publicar Produto no Catálogo'),
    err
  );

  updatePreview(formEl);

  container.replaceChildren(
    h('div', { class: 'panel-surface' }, formEl),
    h('div', { class: 'panel-surface' },
      h('h2', {}, 'Pré-visualização na Vitrine'),
      h('p', { class: 'mute' }, 'Veja abaixo como o card será apresentado aos compradores:'),
      previewHolder
    )
  );
}

/* ------------------------------ TELA 5: AUDITORIA & SEGURANÇA (BLUE TEAM HUB) ------------------------------ */
function renderSegurancaScreen() {
  const container = $('#seguranca-screen-content');
  if (!container) return;

  const sqlScript = [
    'USE kaubum;',
    '',
    '-- 1. Verificar usuários (Senhas em hash Bcrypt e CPF/Telefone cifrados em AES-256-GCM)',
    'SELECT id, nome, email, pass_hash, cpf_enc, phone_enc FROM users;',
    '',
    '-- 2. Verificar transações/pedidos registrados',
    'SELECT id, user_id, (subtotal_cents/100) AS subtotal, (frete_cents/100) AS frete,',
    '       (total_cents/100) AS total, FROM_UNIXTIME(created/1000) AS data_pedido',
    'FROM orders ORDER BY id DESC;',
    '',
    '-- 3. Verificar itens de cada pedido',
    'SELECT * FROM order_items ORDER BY order_id DESC;'
  ].join('\n');

  const defenses = [
    ['A01 · Controle de Acesso & Anti-IDOR', 'O ID do usuário vem exclusivamente da sessão no servidor. Consultas de pedidos filtram por user_id da sessão, impedindo acesso a pedidos de terceiros.'],
    ['A02 · Criptografia AES-256-GCM + Bcrypt', 'CPF, telefone, endereço e cartão são cifrados com AES-256-GCM usando AAD amarrado ao ID do usuário. Senhas usam Bcrypt (12 rounds). O CVV jamais é salvo.'],
    ['A03 · Prepared Statements & NFKC', '100% das queries no MySQL utilizam parâmetros preparados contra SQL Injection. Entradas passam por normalização Unicode NFKC e remoção de caracteres Bidi.'],
    ['A04 · Preço e Frete no Servidor', 'O backend ignora qualquer preço enviado pelo cliente, recalculando subtotal, frete por UF e estoque dentro de uma transação ACID no InnoDB.'],
    ['A05 · CSP Restrita & Anti-CSRF', 'Content-Security-Policy bloqueia scripts externos. Requisições de mutação exigem Double-Submit Cookie (X-CSRF-Token) com comparação timing-safe.'],
    ['A07 · Rate Limiting & Sessão Segura', 'Login e recuperação limitados a 5 tentativas a cada 10 min por IP. Respostas de cadastro e login têm tempo equalizado contra enumeração de usuários.']
  ];

  container.replaceChildren(
    h('div', { class: 'audit-grid' },
      ...defenses.map(([title, desc]) => h('article', { class: 'audit-card' },
        h('h3', {}, h('span', { class: 'dot', 'aria-hidden': 'true' }), title),
        h('p', { class: 'mute' }, desc)
      ))
    ),
    h('div', { class: 'panel-surface' },
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Consultas para Avaliação no MySQL Workbench'),
          h('p', { class: 'mute' }, 'Copie e execute no MySQL Workbench (conexão Local instance MySQL80) para demonstrar os dados cifrados e transações:')
        ),
        h('button', {
          type: 'button',
          class: 'btn pri',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(sqlScript);
              toast('Comandos SQL copiados para a área de transferência');
            } catch {
              toast('Selecione o bloco abaixo para copiar', true);
            }
          }
        }, 'Copiar Comandos SQL')
      ),
      h('pre', { class: 'sql-box', tabindex: '0', 'aria-label': 'Script SQL de auditoria' }, sqlScript),
      S.user ? h('div', { class: 'two' },
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            try { await api('/logout', { method: 'POST' }); } catch { /* ignora */ }
            S.user = null; S.profile = null; updateHeader();
            toast('Sessão atual encerrada');
            renderSegurancaScreen();
          }
        }, 'Encerrar Sessão Atual'),
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            try { await api('/logout-all', { method: 'POST' }); } catch { /* ignora */ }
            S.user = null; S.profile = null; updateHeader();
            toast('Todas as sessões ativas foram revogadas no banco');
            renderSegurancaScreen();
          }
        }, 'Revogar Todas as Sessões do Usuário')
      ) : null
    )
  );
}

/* ------------------------------ Inicialização ------------------------------ */
(async function init() {
  try { await loadProducts(); } catch { toast('Não foi possível carregar os produtos', true); }
  try {
    const s = await api('/sessao');
    if (s.logado) { S.user = s.nome; await loadProfile(); }
  } catch { /* visitante */ }
  updateHeader();
  renderChips();
  renderGrid(true);
})();
})();
