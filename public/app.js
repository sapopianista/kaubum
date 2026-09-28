(() => {
'use strict';
/* Toda renderização usa h() + textContent/createTextNode: nunca innerHTML com dados de usuário (A03). */
const $ = s => document.querySelector(s);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = d => (RM ? 0 : d);
const BRL = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const S = { products: [], cat: 'Todos', cart: new Map(), user: null, profile: null };
try {
  for (const [k, v] of JSON.parse(sessionStorage.getItem('cart') || '[]'))
    if (Number.isInteger(k) && Number.isInteger(v) && v > 0) S.cart.set(k, v);
} catch { /* carrinho corrompido: ignora */ }
const saveCart = () => sessionStorage.setItem('cart', JSON.stringify([...S.cart]));
const items = () => [...S.cart].map(([id, q]) => ({ id, quantidade: q })); // só id + quantidade; o preço é do servidor

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

/* --------------------- Toast, drawers e modal (GSAP) --------------------- */
function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t);
  gsap.fromTo(t, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: dur(.3) });
  setTimeout(() => gsap.to(t, { opacity: 0, duration: dur(.3), onComplete: () => t.remove() }), 3200);
}
let openEl = null;
function show(el) {
  hide(true);
  openEl = el;
  el.classList.add('open');
  $('#scrim').classList.add('open');
  gsap.to('#scrim', { opacity: 1, duration: dur(.3) });
  if (el.classList.contains('modal')) gsap.fromTo(el, { opacity: 0, y: 16, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: dur(.4), ease: 'power3.out' });
  else gsap.fromTo(el, { xPercent: 100 }, { xPercent: 0, duration: dur(.5), ease: 'power3.out' });
  const f = el.querySelector('input,textarea'); if (f) f.focus();
}
function hide(instant) {
  const el = openEl; if (!el) return;
  openEl = null;
  gsap.killTweensOf(el); gsap.killTweensOf('#scrim');
  const fin = () => { el.classList.remove('open'); gsap.set(el, { clearProps: 'transform,opacity' }); };
  if (instant) { fin(); return; }
  gsap.to(el, el.classList.contains('modal')
    ? { opacity: 0, y: 12, duration: dur(.25), onComplete: fin }
    : { xPercent: 100, duration: dur(.35), ease: 'power3.in', onComplete: fin });
  gsap.to('#scrim', { opacity: 0, duration: dur(.3), onComplete: () => $('#scrim').classList.remove('open') });
}
$('#scrim').addEventListener('click', () => hide());
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) hide(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

/* Botões magnéticos */
function magnet(el) {
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * .22, y: (e.clientY - r.top - r.height / 2) * .22, duration: .3 });
  });
  el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: .6, ease: 'elastic.out(1,.5)' }));
}
const arm = () => document.querySelectorAll('.mag:not([data-m])').forEach(e => { e.dataset.m = '1'; if (!RM) magnet(e); });
new MutationObserver(arm).observe(document.body, { childList: true, subtree: true });

/* ------------------------------ Vitrine ------------------------------ */
function renderChips() {
  const cats = ['Todos', ...new Set(S.products.map(p => p.categoria))];
  $('#chips').replaceChildren(...cats.map(c => h('button', {
    type: 'button', class: 'chip' + (c === S.cat ? ' on' : ''), 'aria-pressed': String(c === S.cat),
    onclick: () => { S.cat = c; renderChips(); renderGrid(true); }
  }, c)));
}
function thumb(p) {
  const t = h('div', { class: 'thumb' });
  t.style.setProperty('--h', String(248 + (p.id % 6) * 7));
  const mono = () => t.replaceChildren(h('span', { class: 'mono' }, (p.nome[0] || '?').toUpperCase()));
  if (typeof p.imagem_url === 'string' && p.imagem_url.startsWith('https://')) {
    const img = h('img', { src: p.imagem_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', mono);
    t.append(img);
  } else mono();
  return t;
}
function card(p) {
  return h('article', { class: 'card' }, thumb(p),
    h('div', { class: 'cbody' },
      h('span', { class: 'cat' }, p.categoria),
      h('h3', {}, p.nome),
      h('p', {}, p.descricao),
      h('div', { class: 'cfoot' },
        h('div', {}, h('div', { class: 'price' }, BRL(p.preco)), p.estoque > 0 && p.estoque <= 5 ? h('div', { class: 'low' }, `Restam ${p.estoque}`) : null),
        h('button', { type: 'button', class: 'btn pri mag', disabled: p.estoque < 1 ? 'true' : null, onclick: () => addToCart(p.id) }, p.estoque < 1 ? 'Esgotado' : 'Adicionar'))));
}
function renderGrid(anim) {
  const list = S.products.filter(p => S.cat === 'Todos' || p.categoria === S.cat);
  $('#grid').replaceChildren(...list.map(card));
  if (anim) gsap.from('.card', { y: 28, opacity: 0, duration: dur(.6), stagger: RM ? 0 : .06, ease: 'power3.out' });
}
async function loadProducts() {
  S.products = (await api('/produtos')).produtos;
  for (const id of [...S.cart.keys()]) if (!S.products.some(p => p.id === id)) S.cart.delete(id);
  saveCart(); updateCount();
}

/* ------------------------------ Carrinho ------------------------------ */
const updateCount = () => { $('#cart-count').textContent = [...S.cart.values()].reduce((a, b) => a + b, 0); };
function addToCart(id) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const cur = S.cart.get(id) || 0;
  if (cur + 1 > Math.min(20, p.estoque)) return toast('Quantidade máxima disponível atingida', true);
  S.cart.set(id, cur + 1); saveCart(); updateCount();
  toast(`${p.nome} no carrinho`);
  gsap.fromTo('#btn-cart', { scale: 1.08 }, { scale: 1, duration: dur(.4) });
}
function setQty(id, q) {
  const p = S.products.find(x => x.id === id);
  if (q < 1) S.cart.delete(id); else S.cart.set(id, Math.min(q, 20, p ? p.estoque : 1));
  saveCart(); updateCount(); renderCart();
}
async function renderCart() {
  const body = $('#cart-body'), foot = $('#cart-foot');
  if (!S.cart.size) {
    body.replaceChildren(h('p', { class: 'mute' }, 'Seu carrinho está vazio. Escolha um produto na vitrine.'));
    foot.replaceChildren(); return;
  }
  body.replaceChildren(...[...S.cart].map(([id, q]) => {
    const p = S.products.find(x => x.id === id); if (!p) return null;
    return h('div', { class: 'row' },
      h('div', {}, h('strong', {}, p.nome), h('div', { class: 'mute' }, BRL(p.preco))),
      h('div', { class: 'qty' },
        h('button', { type: 'button', 'aria-label': 'Diminuir quantidade', onclick: () => setQty(id, q - 1) }, '−'),
        h('span', {}, q),
        h('button', { type: 'button', 'aria-label': 'Aumentar quantidade', onclick: () => setQty(id, q + 1) }, '+')));
  }));
  try {
    const t = await api('/cotacao', { method: 'POST', body: { itens: items(), uf: S.profile && S.profile.endereco ? S.profile.endereco.uf : undefined } });
    foot.replaceChildren(
      h('div', { class: 'sum' }, h('span', { class: 'mute' }, 'Subtotal'), h('span', {}, BRL(t.subtotal))),
      h('div', { class: 'sum' }, h('span', { class: 'mute' }, 'Frete'), h('span', {}, t.frete === 0 ? 'Grátis' : BRL(t.frete))),
      h('div', { class: 'sum total' }, h('span', {}, 'Total'), h('span', {}, BRL(t.total))),
      h('button', { type: 'button', class: 'btn pri mag block', onclick: openCheckout }, 'Finalizar compra'));
  } catch (e) { foot.replaceChildren(h('p', { class: 'err', role: 'alert' }, e.message)); }
}
function openCart() { show($('#cart')); renderCart(); }

/* ------------------------ Helpers de formulário ------------------------ */
const fd = f => Object.fromEntries(new FormData(f));
const field = (name, label, type = 'text', extra = {}) =>
  h('label', { class: 'field' }, h('span', {}, label), h('input', { name, type, ...extra }));
const area = (name, label) => h('label', { class: 'field' }, h('span', {}, label), h('textarea', { name, rows: 3, maxlength: 500 }));
const ADDR = [['cep', 'CEP'], ['rua', 'Rua'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['cidade', 'Cidade'], ['uf', 'UF']];
const addrFields = (v = {}) => ADDR.map(([k, l]) => field('end_' + k, l, 'text', { value: v[k] || '', maxlength: k === 'uf' ? 2 : 80, ...(k === 'complemento' ? {} : { required: 'true' }) }));
const readAddr = d => Object.fromEntries(ADDR.map(([k]) => [k, d['end_' + k] || '']));
const fmtAddr = a => a ? `${a.rua}, ${a.numero}${a.complemento ? ' ' + a.complemento : ''} — ${a.bairro}, ${a.cidade}/${a.uf} — CEP ${a.cep}` : 'Não cadastrado';
// Envia o formulário, mostra erros em .err e evita duplo envio
const submit = (errEl, fn) => async e => {
  e.preventDefault(); errEl.textContent = '';
  const btn = e.submitter; if (btn) btn.disabled = true;
  try { await fn(fd(e.target), e.target); } catch (x) { errEl.textContent = x.message; } finally { if (btn) btn.disabled = false; }
};

/* ------------------------------ Autenticação ------------------------------ */
function updateHeader() { $('#btn-account').textContent = S.user ? S.user.split(' ')[0] : 'Entrar'; }
async function loadProfile() { try { S.profile = await api('/perfil'); } catch { S.profile = null; } }
async function afterAuth() { const s = await api('/sessao'); S.user = s.logado ? s.nome : null; await loadProfile(); updateHeader(); }

function openAuth(mode = 'login') {
  const modal = $('#modal');
  $('#modal-title').textContent = { login: 'Entrar', register: 'Criar conta', forgot: 'Recuperar senha', reset: 'Definir nova senha' }[mode];
  const err = h('p', { class: 'err', role: 'alert' });
  const link = (t, m) => h('button', { type: 'button', class: 'lnk', onclick: () => openAuth(m) }, t);
  let form;
  if (mode === 'login') {
    form = h('form', { onsubmit: submit(err, async d => {
      await api('/login', { method: 'POST', body: { email: d.email, senha: d.senha } });
      await afterAuth(); hide(); toast('Sessão iniciada');
    }) },
      field('email', 'E-mail', 'email', { autocomplete: 'username', required: 'true' }),
      field('senha', 'Senha', 'password', { autocomplete: 'current-password', required: 'true' }),
      h('button', { class: 'btn pri mag', type: 'submit' }, 'Entrar'), err,
      h('div', { class: 'links' }, link('Criar conta', 'register'), link('Esqueci a senha', 'forgot')));
  } else if (mode === 'register') {
    form = h('form', { onsubmit: submit(err, async d => {
      const r = await api('/register', { method: 'POST', body: { nome: d.nome, email: d.email, senha: d.senha, cpf: d.cpf, telefone: d.telefone, endereco: readAddr(d) } });
      openAuth('login'); toast(r.mensagem);
    }) },
      field('nome', 'Nome completo', 'text', { required: 'true', maxlength: 80, autocomplete: 'name' }),
      field('email', 'E-mail', 'email', { required: 'true', autocomplete: 'username' }),
      field('senha', 'Senha (10+ caracteres, maiúscula, minúscula e número)', 'password', { required: 'true', minlength: 10, maxlength: 72, autocomplete: 'new-password' }),
      h('div', { class: 'two' }, field('cpf', 'CPF', 'text', { required: 'true', inputmode: 'numeric', maxlength: 14 }), field('telefone', 'Telefone', 'tel', { required: 'true', maxlength: 16 })),
      h('h3', { class: 'sub' }, 'Endereço de entrega'), h('div', { class: 'two' }, addrFields()),
      h('button', { class: 'btn pri mag', type: 'submit' }, 'Criar conta'), err,
      h('div', { class: 'links' }, link('Já tenho conta', 'login')));
  } else if (mode === 'forgot') {
    form = h('form', { onsubmit: submit(err, async d => {
      const r = await api('/forgot', { method: 'POST', body: { email: d.email } });
      openAuth('reset'); toast(r.mensagem);
    }) },
      h('p', { class: 'mute' }, 'Informe seu e-mail. Na aula, o token aparece no console do servidor.'),
      field('email', 'E-mail', 'email', { required: 'true', autocomplete: 'username' }),
      h('button', { class: 'btn pri mag', type: 'submit' }, 'Enviar link'), err,
      h('div', { class: 'links' }, link('Já tenho um token', 'reset'), link('Voltar', 'login')));
  } else {
    form = h('form', { onsubmit: submit(err, async d => {
      const r = await api('/reset', { method: 'POST', body: { token: d.token.trim(), senha: d.senha } });
      openAuth('login'); toast(r.mensagem);
    }) },
      field('token', 'Token recebido', 'text', { required: 'true', maxlength: 64, autocomplete: 'off' }),
      field('senha', 'Nova senha', 'password', { required: 'true', minlength: 10, maxlength: 72, autocomplete: 'new-password' }),
      h('button', { class: 'btn pri mag', type: 'submit' }, 'Salvar nova senha'), err,
      h('div', { class: 'links' }, link('Voltar', 'login')));
  }
  $('#modal-body').replaceChildren(form);
  if (openEl !== modal) show(modal);
}

/* ------------------------------ Checkout ------------------------------ */
async function openCheckout() {
  if (!S.user) return openAuth('login');
  await loadProfile();
  const p = S.profile;
  if (!p || !p.endereco || !p.cartao) { toast('Cadastre endereço e cartão no perfil para finalizar.', true); return openPanel('perfil'); }
  let t;
  try { t = await api('/cotacao', { method: 'POST', body: { itens: items(), uf: p.endereco.uf } }); }
  catch (e) { return toast(e.message, true); }
  const err = h('p', { class: 'err', role: 'alert' });
  $('#modal-title').textContent = 'Finalizar compra';
  $('#modal-body').replaceChildren(
    h('dl', { class: 'kv' }, h('dt', {}, 'Entrega'), h('dd', {}, fmtAddr(p.endereco)), h('dt', {}, 'Cartão'), h('dd', {}, `${p.cartao.mascara} · ${p.cartao.titular}`)),
    h('div', { class: 'sum' }, h('span', { class: 'mute' }, 'Subtotal'), h('span', {}, BRL(t.subtotal))),
    h('div', { class: 'sum' }, h('span', { class: 'mute' }, 'Frete'), h('span', {}, t.frete === 0 ? 'Grátis' : BRL(t.frete))),
    h('div', { class: 'sum total' }, h('span', {}, 'Total'), h('span', {}, BRL(t.total))),
    h('form', { onsubmit: submit(err, async d => {
      const r = await api('/checkout', { method: 'POST', body: { itens: items(), cvv: d.cvv } });
      S.cart.clear(); saveCart(); updateCount();
      await loadProducts(); renderGrid(false);
      toast(`Pedido #${r.id} confirmado`); openPanel('pedidos');
    }) },
      field('cvv', 'CVV (não é armazenado)', 'password', { required: 'true', inputmode: 'numeric', maxlength: 4, autocomplete: 'cc-csc' }),
      h('button', { class: 'btn pri mag', type: 'submit' }, `Pagar ${BRL(t.total)}`), err));
  if (openEl !== $('#modal')) show($('#modal'));
}

/* ------------------------------ Painel da conta ------------------------------ */
const TABS = [['perfil', 'Perfil'], ['pedidos', 'Pedidos'], ['vender', 'Vender'], ['seguranca', 'Segurança']];
async function openPanel(tab = 'perfil') {
  if (!S.user) return openAuth('login');
  $('#tabs').replaceChildren(...TABS.map(([k, l]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(k === tab), class: 'tab' + (k === tab ? ' on' : ''), onclick: () => openPanel(k)
  }, l)));
  const box = $('#panel-body');
  box.replaceChildren(h('p', { class: 'mute' }, 'Carregando…'));
  if (openEl !== $('#panel')) show($('#panel'));
  try {
    await ({ perfil: tabPerfil, pedidos: tabPedidos, vender: tabVender, seguranca: tabSeg })[tab](box);
    gsap.from('#panel-body > *', { y: 12, opacity: 0, stagger: RM ? 0 : .05, duration: dur(.35) });
  } catch (e) {
    if (e.status === 401) { S.user = null; updateHeader(); hide(true); openAuth('login'); }
    else box.replaceChildren(h('p', { class: 'err', role: 'alert' }, e.message));
  }
}
const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v)];

async function tabPerfil(box) {
  const p = await api('/perfil'); S.profile = p;
  const err = h('p', { class: 'err', role: 'alert' });
  box.replaceChildren(
    h('dl', { class: 'kv' }, kv('Nome', p.nome), kv('E-mail', p.email), kv('CPF', p.cpf || 'Não cadastrado'), kv('Telefone', p.telefone || 'Não cadastrado'),
      kv('Endereço', fmtAddr(p.endereco)), kv('Cartão', p.cartao ? `${p.cartao.mascara} · ${p.cartao.titular} · ${p.cartao.validade}` : 'Não cadastrado')),
    h('h3', { class: 'sub' }, 'Atualizar dados (campos vazios mantêm o valor atual)'),
    h('form', { onsubmit: submit(err, async d => {
      await api('/perfil', { method: 'PUT', body: { cpf: d.cpf, telefone: d.telefone, endereco: readAddr(d), cartao: { numero: d.c_numero, validade: d.c_validade, titular: d.c_titular } } });
      toast('Perfil atualizado'); await openPanel('perfil');
    }) },
      h('div', { class: 'two' }, field('cpf', 'CPF', 'text', { inputmode: 'numeric', maxlength: 14 }), field('telefone', 'Telefone', 'tel', { maxlength: 16 })),
      h('div', { class: 'two' }, addrFields(p.endereco || {})),
      h('h3', { class: 'sub' }, 'Cartão de crédito'),
      field('c_numero', 'Número do cartão', 'text', { inputmode: 'numeric', maxlength: 23, autocomplete: 'cc-number' }),
      h('div', { class: 'two' }, field('c_validade', 'Validade (MM/AA)', 'text', { maxlength: 5, autocomplete: 'cc-exp' }), field('c_titular', 'Titular', 'text', { maxlength: 60, autocomplete: 'cc-name' })),
      h('button', { class: 'btn pri mag', type: 'submit' }, 'Salvar'), err));
}

async function tabPedidos(box) {
  const { pedidos } = await api('/pedidos');
  if (!pedidos.length) return box.replaceChildren(h('p', { class: 'mute' }, 'Você ainda não fez pedidos.'));
  box.replaceChildren(...pedidos.map(o => {
    const det = h('div', {});
    return h('div', { class: 'order' },
      h('div', { class: 'sum' }, h('strong', {}, `Pedido #${o.id}`), h('span', { class: 'pill' }, o.status)),
      h('div', { class: 'sum mute' }, h('span', {}, new Date(o.data).toLocaleString('pt-BR')), h('span', {}, BRL(o.total))),
      h('button', { type: 'button', class: 'lnk', onclick: async () => {
        try {
          const d = await api('/pedidos/' + o.id);
          det.replaceChildren(...d.itens.map(i => h('div', { class: 'sum' }, h('span', {}, `${i.quantidade}× ${i.nome}`), h('span', {}, BRL(i.unitario * i.quantidade)))),
            h('div', { class: 'sum mute' }, h('span', {}, 'Frete'), h('span', {}, d.frete === 0 ? 'Grátis' : BRL(d.frete))),
            h('p', { class: 'mute' }, 'Entrega: ' + fmtAddr(d.endereco)));
        } catch (e) { det.replaceChildren(h('p', { class: 'err' }, e.message)); }
      } }, 'Ver detalhes'), det);
  }));
}

async function tabVender(box) {
  const err = h('p', { class: 'err', role: 'alert' });
  box.replaceChildren(h('form', { onsubmit: submit(err, async (d, f) => {
    await api('/produtos', { method: 'POST', body: {
      nome: d.nome, preco: Number(String(d.preco).replace(',', '.')), categoria: d.categoria,
      estoque: Number(d.estoque), descricao: d.descricao, imagem_url: d.imagem_url
    } });
    f.reset(); await loadProducts(); renderChips(); renderGrid(false); toast('Produto publicado na vitrine');
  }) },
    field('nome', 'Nome do produto', 'text', { required: 'true', maxlength: 80 }),
    h('div', { class: 'two' }, field('preco', 'Preço (R$)', 'text', { required: 'true', inputmode: 'decimal' }), field('estoque', 'Estoque', 'number', { required: 'true', min: 0, max: 9999, step: 1 })),
    field('categoria', 'Categoria', 'text', { required: 'true', maxlength: 30 }),
    area('descricao', 'Descrição'),
    field('imagem_url', 'URL da imagem (https://, opcional)', 'url', { maxlength: 400 }),
    h('button', { class: 'btn pri mag', type: 'submit' }, 'Publicar produto'), err));
}

async function tabSeg(box) {
  box.replaceChildren(
    h('ul', { class: 'shield' },
      h('li', {}, 'CPF, telefone, endereço e cartão ficam cifrados em repouso (AES-256-GCM).'),
      h('li', {}, 'Esta tela só recebe CPF e cartão mascarados; o CVV nunca é guardado.'),
      h('li', {}, 'Sua sessão vive em um cookie HttpOnly + SameSite=Strict e expira em 2 horas.'),
      h('li', {}, 'Preço e frete são sempre recalculados no servidor.')),
    h('button', { type: 'button', class: 'btn mag', onclick: async () => {
      try { await api('/logout', { method: 'POST' }); } catch { /* sessão já expirada */ }
      S.user = null; S.profile = null; updateHeader(); hide(); toast('Você saiu da conta');
    } }, 'Sair da conta'));
}

/* ------------------------------ Badge de segurança ------------------------------ */
const badgeBtn = $('#badge-btn'), badgeList = $('#badge-list');
badgeBtn.addEventListener('click', () => {
  const open = badgeList.hidden;
  badgeList.hidden = !open; badgeBtn.setAttribute('aria-expanded', String(open));
  if (open) gsap.from(badgeList, { y: 10, opacity: 0, duration: dur(.3) });
});
if (!RM) gsap.to('.dot', { scale: 1.5, opacity: .35, duration: 1.1, repeat: -1, yoyo: true, ease: 'sine.inOut' });

/* ------------------------------ Início ------------------------------ */
$('#btn-cart').addEventListener('click', openCart);
$('#btn-account').addEventListener('click', () => (S.user ? openPanel('perfil') : openAuth('login')));

(async function init() {
  arm();
  gsap.from('.hero .ln > span', { yPercent: 110, duration: dur(.9), stagger: RM ? 0 : .12, ease: 'power4.out' });
  try { await loadProducts(); } catch { toast('Não foi possível carregar os produtos', true); }
  try { const s = await api('/sessao'); if (s.logado) { S.user = s.nome; await loadProfile(); } } catch { /* visitante */ }
  updateHeader(); renderChips(); renderGrid(true);
})();
})();
