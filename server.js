'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const catalog = require('./catalog');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // use HOST=0.0.0.0 para a turma acessar pela rede
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // ligue se usar HTTPS
const SESSION_MS = 2 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

class HttpErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ------------------------------------------------------------------ *
 * A02 — Chave AES-256 (env ENC_KEY com 64 hex, ou gerada em data/.enckey)
 * ------------------------------------------------------------------ */
function loadKey() {
  if (process.env.ENC_KEY) {
    const k = Buffer.from(process.env.ENC_KEY, 'hex');
    if (k.length !== 32) throw new Error('ENC_KEY deve ter 64 caracteres hexadecimais');
    return k;
  }
  const f = path.join(__dirname, 'data', '.enckey');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
const KEY = loadKey();

// AES-256-GCM. O AAD amarra o texto cifrado ao usuário e ao campo:
// copiar o CPF cifrado de um usuário para outro falha na autenticação.
function enc(plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.');
}
function dec(s, aad) {
  const [iv, tag, ct] = s.split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ------------------------------------------------------------------ *
 * Banco (SQLite) — TODAS as queries usam prepared statements (A03)
 * ------------------------------------------------------------------ */
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'loja.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, pass_hash TEXT NOT NULL,
  cpf_enc TEXT, phone_enc TEXT, addr_enc TEXT, card_enc TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reset_tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, preco_cents INTEGER NOT NULL CHECK(preco_cents > 0),
  categoria TEXT NOT NULL, estoque INTEGER NOT NULL CHECK(estoque >= 0), descricao TEXT NOT NULL DEFAULT '', imagem_url TEXT NOT NULL DEFAULT '',
  seller_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), subtotal_cents INTEGER NOT NULL,
  frete_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, addr_enc TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL, nome TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_cents INTEGER NOT NULL);
`);

// Semeia o catálogo (não mexe em produtos criados por usuários)
const seed = db.prepare(`INSERT INTO products(id,nome,preco_cents,categoria,estoque,descricao,imagem_url,seller_id)
  VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, preco_cents=excluded.preco_cents,
  categoria=excluded.categoria, estoque=excluded.estoque, descricao=excluded.descricao, imagem_url=excluded.imagem_url
  WHERE products.seller_id IS NULL`);
for (const p of catalog) {
  if (!Number.isInteger(p.id) || p.id < 1 || p.id > 999) throw new Error(`catalog.js: id inválido (${p.id}); use 1..999`);
  seed.run(p.id, p.nome, Math.round(p.preco * 100), p.categoria, p.estoque, p.descricao || '', p.imagem_url || '');
}

/* ------------------------------------------------------------------ *
 * Validação / sanitização (A03)
 * ------------------------------------------------------------------ */
const clean = (s, max) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max) : '');
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const B = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

function normEmail(e) {
  if (typeof e !== 'string') return null;
  e = e.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) ? e : null;
}
const strongPw = s => typeof s === 'string' && s.length >= 10 && s.length <= 72 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);

function validCPF(c) {
  c = String(c).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
function luhn(n) {
  let s = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) { let d = Number(n[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; }
  return s % 10 === 0;
}
const validadeOk = v => /^(0[1-9]|1[0-2])\/\d{2}$/.test(v) && new Date(2000 + Number(v.slice(3)), Number(v.slice(0, 2)), 1) > new Date();

function parseAddr(e) {
  if (!e || typeof e !== 'object') throw new HttpErr(400, 'Endereço inválido');
  const a = {
    cep: String(e.cep ?? '').replace(/\D/g, ''), rua: clean(e.rua, 80), numero: clean(e.numero, 10),
    complemento: clean(e.complemento, 40), bairro: clean(e.bairro, 60), cidade: clean(e.cidade, 60), uf: clean(e.uf, 2).toUpperCase()
  };
  if (!/^\d{8}$/.test(a.cep) || a.rua.length < 3 || !a.numero || a.bairro.length < 2 || a.cidade.length < 2 || !UFS.includes(a.uf))
    throw new HttpErr(400, 'Endereço incompleto ou inválido');
  return a;
}
function parseCard(c) {
  const numero = String(c.numero ?? '').replace(/[\s-]/g, '');
  const validade = clean(c.validade, 5);
  const titular = clean(c.titular, 60);
  if (!/^\d{13,19}$/.test(numero) || !luhn(numero)) throw new HttpErr(400, 'Número de cartão inválido');
  if (!validadeOk(validade)) throw new HttpErr(400, 'Validade inválida ou vencida (use MM/AA)');
  if (!/^[\p{L} .'-]{3,60}$/u.test(titular)) throw new HttpErr(400, 'Nome do titular inválido');
  return { numero, validade, titular: titular.toUpperCase() }; // CVV NUNCA é lido aqui nem armazenado
}
// partial=true: campos vazios significam "manter o atual" (edição de perfil)
function parsePII(b, partial) {
  const out = {}, blank = v => v === undefined || v === null || v === '';
  if (!partial || !blank(b.cpf)) {
    if (!validCPF(b.cpf)) throw new HttpErr(400, 'CPF inválido');
    out.cpf = String(b.cpf).replace(/\D/g, '');
  }
  if (!partial || !blank(b.telefone)) {
    const t = String(b.telefone ?? '').replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(t)) throw new HttpErr(400, 'Telefone inválido');
    out.telefone = t;
  }
  const e = b.endereco;
  if (!partial || (e && typeof e === 'object' && !blank(e.cep))) out.endereco = parseAddr(e);
  const c = b.cartao;
  if (c && typeof c === 'object' && !blank(c.numero)) out.cartao = parseCard(c);
  return out;
}
// Colunas vêm de uma lista constante (nunca de input do usuário)
const PII_COLS = [['cpf', 'cpf_enc'], ['telefone', 'phone_enc'], ['endereco', 'addr_enc'], ['cartao', 'card_enc']];
function savePII(uid, p) {
  const sets = [], vals = [];
  for (const [k, col] of PII_COLS) {
    if (p[k] === undefined) continue;
    sets.push(`${col}=?`);
    vals.push(enc(typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k]), `u${uid}:${k}`));
  }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals, uid);
}
// A02 — máscaras: o front nunca recebe CPF/cartão completos
const maskCPF = c => `***.***.***-${c.slice(-2)}`;
const maskCard = n => `**** **** **** ${n.slice(-4)}`;
const maskPhone = t => `(**) *****-${t.slice(-4)}`;

/* ------------------------------------------------------------------ *
 * A04 — Preço e frete calculados SOMENTE no servidor
 * ------------------------------------------------------------------ */
const REGION = { SP: 1500, RJ: 1800, MG: 1800, ES: 1900, PR: 2200, SC: 2200, RS: 2400, DF: 2600, GO: 2600, MT: 3000, MS: 3000 };
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) throw new HttpErr(400, 'Carrinho inválido');
  const m = new Map();
  for (const it of raw) {
    // Qualquer campo "preco" enviado pelo cliente é simplesmente ignorado.
    if (!it || typeof it !== 'object' || !Number.isInteger(it.id) || it.id < 1 || !Number.isInteger(it.quantidade) || it.quantidade < 1)
      throw new HttpErr(400, 'Item inválido');
    m.set(it.id, (m.get(it.id) || 0) + it.quantidade);
  }
  for (const q of m.values()) if (q > 20) throw new HttpErr(400, 'Máximo de 20 unidades por produto');
  return [...m].map(([id, q]) => ({ id, q }));
}
function price(items, uf) {
  const sel = db.prepare('SELECT id,nome,preco_cents,estoque FROM products WHERE id=?');
  let sub = 0, n = 0;
  const lines = [];
  for (const it of items) {
    const p = sel.get(it.id);
    if (!p) throw new HttpErr(404, 'Produto não encontrado');
    if (p.estoque < it.q) throw new HttpErr(409, `Estoque insuficiente: ${p.nome}`);
    sub += p.preco_cents * it.q; n += it.q;
    lines.push({ ...p, q: it.q });
  }
  const frete = sub >= 30000 ? 0 : (REGION[uf] || 3500) + (n - 1) * 200;
  return { lines, sub, frete, total: sub + frete };
}
const reais = c => c / 100;
const deliveryStatus = created => { // simulação para a demo em aula
  const m = (Date.now() - created) / 60000;
  return m < 1 ? 'Pagamento aprovado' : m < 2 ? 'Em separação' : m < 4 ? 'Em transporte' : 'Entregue';
};

/* ------------------------------------------------------------------ *
 * Sessão (cookie HttpOnly + SameSite=Strict; só o HASH do id fica no banco) — A01/A07
 * ------------------------------------------------------------------ */
function newSession(res, uid) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(id_hash,user_id,expires) VALUES(?,?,?)').run(sha(sid), uid, Date.now() + SESSION_MS);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: SESSION_MS, path: '/' });
}
function getUid(req) {
  const sid = req.cookies.sid;
  if (typeof sid !== 'string' || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const r = db.prepare('SELECT user_id,expires FROM sessions WHERE id_hash=?').get(sha(sid));
  return r && r.expires > Date.now() ? r.user_id : null;
}
function auth(req, res, next) {
  const uid = getUid(req);
  if (!uid) return res.status(401).json({ erro: 'Não autenticado' });
  req.uid = uid; // o id vem SEMPRE da sessão, nunca do corpo/URL
  next();
}

/* ------------------------------------------------------------------ *
 * CSRF: double-submit cookie + checagem de Origin (A05)
 * ------------------------------------------------------------------ */
function csrf(req, res, next) {
  let tok = req.cookies.csrf;
  if (typeof tok !== 'string' || !/^[a-f0-9]{64}$/.test(tok)) {
    tok = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf', tok, { httpOnly: false, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
    req.cookies.csrf = tok;
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ erro: 'Origem não permitida' });
  const a = Buffer.from(String(req.get('x-csrf-token') || '')), b = Buffer.from(tok);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ erro: 'Token CSRF inválido' });
  next();
}

/* ------------------------------------------------------------------ *
 * App + Helmet (CSP restrita: tudo 'self'; o GSAP é servido localmente) — A05
 * ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"], fontSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      baseUri: ["'none'"], objectSrc: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(csrf);
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));
app.get('/vendor/gsap.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'gsap', 'dist', 'gsap.min.js')));

// Rate limiting (A07): 5 tentativas / 10 min / IP em login, recuperação e redefinição
const msg429 = { erro: 'Muitas tentativas. Aguarde 10 minutos.' };
const rl = (limit, extra = {}) => rateLimit({ windowMs: 10 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: msg429, ...extra });
const loginLimiter = rl(5, { skipSuccessfulRequests: true });
const recoveryLimiter = rl(5);
const registerLimiter = rl(10);
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas requisições' } }));

const w = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-tempo', BCRYPT_ROUNDS);

/* ----------------------------- Autenticação ----------------------------- */
app.get('/api/sessao', (req, res) => {
  const uid = getUid(req);
  const u = uid && db.prepare('SELECT nome FROM users WHERE id=?').get(uid);
  res.json(u ? { logado: true, nome: u.nome } : { logado: false });
});

app.post('/api/register', registerLimiter, w(async (req, res) => {
  const b = B(req);
  const nome = clean(b.nome, 80), email = normEmail(b.email);
  if (nome.length < 3) throw new HttpErr(400, 'Nome inválido');
  if (!email) throw new HttpErr(400, 'E-mail inválido');
  if (!strongPw(b.senha)) throw new HttpErr(400, 'Senha: 10 a 72 caracteres com maiúscula, minúscula e número');
  const pii = parsePII(b, false);
  const hash = await bcrypt.hash(b.senha, BCRYPT_ROUNDS);
  try {
    db.transaction(() => {
      const id = Number(db.prepare('INSERT INTO users(email,nome,pass_hash,created) VALUES(?,?,?,?)').run(email, nome, hash, Date.now()).lastInsertRowid);
      savePII(id, pii);
    })();
  } catch (e) {
    if (!String(e.code).startsWith('SQLITE_CONSTRAINT')) throw e;
    console.log('[registro] e-mail já existente — resposta idêntica enviada (anti-enumeração)');
  }
  // Mesma resposta com ou sem duplicidade (A07 — User Enumeration)
  res.status(201).json({ ok: true, mensagem: 'Cadastro recebido. Entre com seu e-mail e senha.' });
}));

app.post('/api/login', loginLimiter, w(async (req, res) => {
  const b = B(req), email = normEmail(b.email);
  const u = email ? db.prepare('SELECT id,nome,pass_hash FROM users WHERE email=?').get(email) : null;
  // Sempre executa o bcrypt (mesmo sem usuário) para igualar o tempo de resposta
  const ok = await bcrypt.compare(typeof b.senha === 'string' ? b.senha.slice(0, 72) : '', u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpErr(401, 'Credenciais inválidas');
  newSession(res, u.id); // novo id a cada login (anti session fixation)
  res.json({ ok: true, nome: u.nome });
}));

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha(req.cookies.sid));
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

app.post('/api/forgot', recoveryLimiter, (req, res) => {
  const email = normEmail(B(req).email);
  const u = email && db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE reset_tokens SET used=1 WHERE user_id=?').run(u.id); // invalida tokens anteriores
    db.prepare('INSERT INTO reset_tokens(token_hash,user_id,expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 15 * 60 * 1000);
    console.log(`\n[E-MAIL SIMULADO] Recuperação de senha para ${email}\n  Token: ${token}\n  Expira em 15 minutos, uso único.\n`);
  }
  res.json({ ok: true, mensagem: 'Se o e-mail existir, um link foi enviado.' });
});

app.post('/api/reset', recoveryLimiter, w(async (req, res) => {
  const b = B(req);
  if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) throw new HttpErr(400, 'Token inválido ou expirado');
  if (!strongPw(b.senha)) throw new HttpErr(400, 'Senha: 10 a 72 caracteres com maiúscula, minúscula e número');
  const hash = await bcrypt.hash(b.senha, BCRYPT_ROUNDS);
  db.transaction(() => {
    const th = sha(b.token);
    // UPDATE atômico: só um pedido consegue "gastar" o token
    if (db.prepare('UPDATE reset_tokens SET used=1 WHERE token_hash=? AND used=0 AND expires>?').run(th, Date.now()).changes !== 1)
      throw new HttpErr(400, 'Token inválido ou expirado');
    const { user_id } = db.prepare('SELECT user_id FROM reset_tokens WHERE token_hash=?').get(th);
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hash, user_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user_id); // derruba sessões ativas
  })();
  res.json({ ok: true, mensagem: 'Senha alterada. Entre com a nova senha.' });
}));

/* -------------------------------- Perfil -------------------------------- */
app.get('/api/perfil', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.uid);
  const D = (col, f) => (u[col] ? dec(u[col], `u${u.id}:${f}`) : null);
  const cpf = D('cpf_enc', 'cpf'), tel = D('phone_enc', 'telefone'), end = D('addr_enc', 'endereco'), card = D('card_enc', 'cartao');
  const c = card && JSON.parse(card);
  res.json({
    nome: u.nome, email: u.email,
    cpf: cpf && maskCPF(cpf), telefone: tel && maskPhone(tel), endereco: end && JSON.parse(end),
    cartao: c && { mascara: maskCard(c.numero), titular: c.titular, validade: c.validade }
  });
});
app.put('/api/perfil', auth, (req, res) => {
  savePII(req.uid, parsePII(B(req), true));
  res.json({ ok: true });
});

/* ------------------------------- Produtos ------------------------------- */
app.get('/api/produtos', (req, res) => {
  const rows = db.prepare('SELECT id,nome,preco_cents,categoria,estoque,descricao,imagem_url FROM products ORDER BY id').all();
  res.json({ produtos: rows.map(({ preco_cents, ...p }) => ({ ...p, preco: reais(preco_cents) })) });
});
app.post('/api/produtos', auth, (req, res) => {
  const b = B(req);
  const nome = clean(b.nome, 80), categoria = clean(b.categoria, 30), descricao = clean(b.descricao, 500);
  const preco = typeof b.preco === 'number' || typeof b.preco === 'string' ? Number(b.preco) : NaN;
  const cents = Math.round(preco * 100), estoque = b.estoque;
  if (nome.length < 3 || categoria.length < 2) throw new HttpErr(400, 'Nome ou categoria inválidos');
  if (!Number.isFinite(cents) || cents < 1 || cents > 10_000_000) throw new HttpErr(400, 'Preço inválido');
  if (!Number.isInteger(estoque) || estoque < 0 || estoque > 9999) throw new HttpErr(400, 'Estoque inválido');
  let img = '';
  if (b.imagem_url) {
    try { const u = new URL(String(b.imagem_url)); if (u.protocol !== 'https:' || String(b.imagem_url).length > 400 || /[\s<>"']/.test(String(b.imagem_url))) throw 0; img = u.href; }
    catch { throw new HttpErr(400, 'URL de imagem deve ser https:// válida'); }
  }
  if (db.prepare('SELECT COUNT(*) n FROM products WHERE seller_id=?').get(req.uid).n >= 50) throw new HttpErr(429, 'Limite de 50 produtos por vendedor');
  const r = db.prepare(`INSERT INTO products(id,nome,preco_cents,categoria,estoque,descricao,imagem_url,seller_id)
    VALUES((SELECT MAX(999, COALESCE(MAX(id),0)) + 1 FROM products),?,?,?,?,?,?,?)`).run(nome, cents, categoria, estoque, descricao, img, req.uid);
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
});

/* ------------------------- Cotação, checkout, pedidos ------------------------- */
app.post('/api/cotacao', (req, res) => {
  const b = B(req);
  const uf = UFS.includes(String(b.uf).toUpperCase()) ? String(b.uf).toUpperCase() : 'SP';
  const q = price(parseItems(b.itens), uf);
  res.json({ subtotal: reais(q.sub), frete: reais(q.frete), total: reais(q.total) });
});

const checkoutTx = db.transaction((uid, items, uf, addrEnc) => {
  const q = price(items, uf); // relê preço e estoque DENTRO da transação
  const dc = db.prepare('UPDATE products SET estoque=estoque-? WHERE id=? AND estoque>=?');
  for (const l of q.lines) if (dc.run(l.q, l.id, l.q).changes !== 1) throw new HttpErr(409, `Estoque insuficiente: ${l.nome}`);
  const oid = Number(db.prepare('INSERT INTO orders(user_id,subtotal_cents,frete_cents,total_cents,addr_enc,created) VALUES(?,?,?,?,?,?)')
    .run(uid, q.sub, q.frete, q.total, addrEnc, Date.now()).lastInsertRowid);
  const ins = db.prepare('INSERT INTO order_items(order_id,product_id,nome,qty,unit_cents) VALUES(?,?,?,?,?)');
  for (const l of q.lines) ins.run(oid, l.id, l.nome, l.q, l.preco_cents);
  return { id: oid, total: reais(q.total) };
});
app.post('/api/checkout', auth, (req, res) => {
  const b = B(req);
  const items = parseItems(b.itens);
  // O CVV é validado só quanto ao formato e descartado: nunca é gravado nem logado.
  if (typeof b.cvv !== 'string' || !/^\d{3,4}$/.test(b.cvv)) throw new HttpErr(400, 'CVV inválido');
  const u = db.prepare('SELECT addr_enc,card_enc FROM users WHERE id=?').get(req.uid);
  if (!u.addr_enc || !u.card_enc) throw new HttpErr(400, 'Cadastre endereço e cartão no perfil');
  const card = JSON.parse(dec(u.card_enc, `u${req.uid}:cartao`));
  if (!validadeOk(card.validade)) throw new HttpErr(400, 'Cartão vencido');
  const uf = JSON.parse(dec(u.addr_enc, `u${req.uid}:endereco`)).uf;
  // (Aqui haveria a cobrança no gateway de pagamento; na aula é apenas simulada.)
  res.status(201).json({ ok: true, ...checkoutTx(req.uid, items, uf, u.addr_enc) });
});

app.get('/api/pedidos', auth, (req, res) => {
  const rows = db.prepare('SELECT id,total_cents,created FROM orders WHERE user_id=? ORDER BY id DESC').all(req.uid);
  res.json({ pedidos: rows.map(o => ({ id: o.id, data: new Date(o.created).toISOString(), status: deliveryStatus(o.created), total: reais(o.total_cents) })) });
});
app.get('/api/pedidos/:id', auth, (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw new HttpErr(404, 'Pedido não encontrado');
  // A01/IDOR: o filtro por user_id vem da SESSÃO. Pedido alheio e pedido inexistente dão a mesma resposta.
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(req.params.id), req.uid);
  if (!o) throw new HttpErr(404, 'Pedido não encontrado');
  const itens = db.prepare('SELECT nome,qty,unit_cents FROM order_items WHERE order_id=?').all(o.id);
  res.json({
    id: o.id, data: new Date(o.created).toISOString(), status: deliveryStatus(o.created),
    itens: itens.map(i => ({ nome: i.nome, quantidade: i.qty, unitario: reais(i.unit_cents) })),
    subtotal: reais(o.subtotal_cents), frete: reais(o.frete_cents), total: reais(o.total_cents),
    endereco: JSON.parse(dec(o.addr_enc, `u${req.uid}:endereco`))
  });
});

/* ------------------------------ Erros ------------------------------ */
app.use('/api', (req, res) => res.status(404).json({ erro: 'Não encontrado' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpErr) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ erro: 'Requisição inválida' });
  console.error(err); // detalhes só no console; o cliente recebe mensagem genérica (sem stack trace)
  res.status(500).json({ erro: 'Erro interno' });
});

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  db.prepare('DELETE FROM reset_tokens WHERE expires<?').run(Date.now());
}, 60_000).unref();

app.listen(PORT, HOST, () => console.log(`Obsidiana no ar: http://${HOST}:${PORT}`));
