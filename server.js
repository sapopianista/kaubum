'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const catalog = require('./catalog');
const db = require('./src/db');
const { enc, safeDec, sha } = require('./src/crypto');
const {
  HttpErr, clean, UFS, B, normEmail, strongPw,
  validadeOk, parsePII, maskCPF, maskCard, maskPhone, parseItems
} = require('./src/validators');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 para acesso via rede local
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1'; // ligue se usar HTTPS
const SESSION_MS = 2 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

// Colunas vêm de uma lista constante (nunca de input do usuário)
const PII_COLS = [['cpf', 'cpf_enc'], ['telefone', 'phone_enc'], ['endereco', 'addr_enc'], ['cartao', 'card_enc']];

async function savePII(uid, p, executor = db) {
  const sets = [], vals = [];
  for (const [k, col] of PII_COLS) {
    if (p[k] === undefined) continue;
    sets.push(`${col}=?`);
    vals.push(enc(typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k]), `u${uid}:${k}`));
  }
  if (sets.length) {
    await executor.run(`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...vals, uid]);
  }
}

/* ------------------------------------------------------------------ *
 * A04 — Preço e frete calculados SOMENTE no servidor
 * ------------------------------------------------------------------ */
const REGION = { SP: 1500, RJ: 1800, MG: 1800, ES: 1900, PR: 2200, SC: 2200, RS: 2400, DF: 2600, GO: 2600, MT: 3000, MS: 3000 };

async function price(items, uf, executor = db) {
  let sub = 0, n = 0;
  const lines = [];
  for (const it of items) {
    const p = await executor.get('SELECT id,nome,preco_cents,estoque FROM products WHERE id=?', [it.id]);
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
async function newSession(res, uid) {
  const sid = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions(id_hash,user_id,expires) VALUES(?,?,?)', [sha(sid), uid, Date.now() + SESSION_MS]);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: SESSION_MS, path: '/' });
}

async function getUid(req) {
  const sid = req.cookies.sid;
  if (typeof sid !== 'string' || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const r = await db.get('SELECT user_id,expires FROM sessions WHERE id_hash=?', [sha(sid)]);
  return r && r.expires > Date.now() ? r.user_id : null;
}

const w = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const auth = w(async (req, res, next) => {
  const uid = await getUid(req);
  if (!uid) return res.status(401).json({ erro: 'Não autenticado' });
  req.uid = uid; // o id vem SEMPRE da sessão, nunca do corpo/URL
  next();
});

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
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || true : 1);

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
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
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

const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-tempo', BCRYPT_ROUNDS);

/* ----------------------------- Autenticação ----------------------------- */
app.get('/api/sessao', w(async (req, res) => {
  const uid = await getUid(req);
  const u = uid ? await db.get('SELECT nome FROM users WHERE id=?', [uid]) : null;
  res.json(u ? { logado: true, nome: u.nome } : { logado: false });
}));

app.post('/api/register', registerLimiter, w(async (req, res) => {
  const b = B(req);
  const nome = clean(b.nome, 80), email = normEmail(b.email);
  if (nome.length < 3) throw new HttpErr(400, 'Nome inválido (mínimo 3 caracteres)');
  if (!email) throw new HttpErr(400, 'E-mail inválido');
  if (!strongPw(b.senha)) throw new HttpErr(400, 'Senha: 10 a 72 caracteres com maiúscula, minúscula e número');
  const pii = parsePII(b, false);
  const hash = await bcrypt.hash(b.senha, BCRYPT_ROUNDS);
  try {
    await db.transaction(async tx => {
      const r = await tx.run('INSERT INTO users(email,nome,pass_hash,created) VALUES(?,?,?,?)', [email, nome, hash, Date.now()]);
      const id = r.lastInsertRowid;
      await savePII(id, pii, tx);
    });
  } catch (e) {
    const isDup = String(e.code).startsWith('SQLITE_CONSTRAINT') || e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
    if (!isDup) throw e;
    console.log('[registro] e-mail já existente — resposta idêntica enviada (anti-enumeração)');
  }
  // Mesma resposta com ou sem duplicidade (A07 — User Enumeration)
  res.status(201).json({ ok: true, mensagem: 'Cadastro recebido. Entre com seu e-mail e senha.' });
}));

app.post('/api/login', loginLimiter, w(async (req, res) => {
  const b = B(req), email = normEmail(b.email);
  const u = email ? await db.get('SELECT id,nome,pass_hash FROM users WHERE email=?', [email]) : null;
  // Sempre executa o bcrypt (mesmo sem usuário) para igualar o tempo de resposta
  const ok = await bcrypt.compare(typeof b.senha === 'string' ? b.senha.slice(0, 72) : '', u ? u.pass_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpErr(401, 'Credenciais inválidas');
  await newSession(res, u.id); // novo id a cada login (anti session fixation)
  res.json({ ok: true, nome: u.nome });
}));

app.post('/api/logout', auth, w(async (req, res) => {
  await db.run('DELETE FROM sessions WHERE id_hash=?', [sha(req.cookies.sid)]);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
}));

app.post('/api/logout-all', auth, w(async (req, res) => {
  await db.run('DELETE FROM sessions WHERE user_id=?', [req.uid]);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
}));

app.post('/api/forgot', recoveryLimiter, w(async (req, res) => {
  const email = normEmail(B(req).email);
  const u = email ? await db.get('SELECT id FROM users WHERE email=?', [email]) : null;
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('UPDATE reset_tokens SET used=1 WHERE user_id=?', [u.id]); // invalida tokens anteriores
    await db.run('INSERT INTO reset_tokens(token_hash,user_id,expires) VALUES(?,?,?)', [sha(token), u.id, Date.now() + 15 * 60 * 1000]);
    console.log(`\n[E-MAIL SIMULADO] Recuperação de senha para ${email}\n  Token: ${token}\n  Expira em 15 minutos, uso único.\n`);
  }
  res.json({ ok: true, mensagem: 'Se o e-mail existir, um link foi enviado.' });
}));

app.post('/api/reset', recoveryLimiter, w(async (req, res) => {
  const b = B(req);
  if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) throw new HttpErr(400, 'Token inválido ou expirado');
  if (!strongPw(b.senha)) throw new HttpErr(400, 'Senha: 10 a 72 caracteres com maiúscula, minúscula e número');
  const hash = await bcrypt.hash(b.senha, BCRYPT_ROUNDS);
  await db.transaction(async tx => {
    const th = sha(b.token);
    // UPDATE atômico: só um pedido consegue "gastar" o token
    const upd = await tx.run('UPDATE reset_tokens SET used=1 WHERE token_hash=? AND used=0 AND expires>?', [th, Date.now()]);
    if (upd.changes !== 1) throw new HttpErr(400, 'Token inválido ou expirado');
    const tok = await tx.get('SELECT user_id FROM reset_tokens WHERE token_hash=?', [th]);
    await tx.run('UPDATE users SET pass_hash=? WHERE id=?', [hash, tok.user_id]);
    await tx.run('DELETE FROM sessions WHERE user_id=?', [tok.user_id]); // derruba sessões ativas
  });
  res.json({ ok: true, mensagem: 'Senha alterada. Entre com a nova senha.' });
}));

/* -------------------------------- Perfil -------------------------------- */
app.get('/api/perfil', auth, w(async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id=?', [req.uid]);
  if (!u) throw new HttpErr(404, 'Usuário não encontrado');
  const D = (col, f) => (u[col] ? safeDec(u[col], `u${u.id}:${f}`) : null);
  const cpf = D('cpf_enc', 'cpf'), tel = D('phone_enc', 'telefone'), endRaw = D('addr_enc', 'endereco'), cardRaw = D('card_enc', 'cartao');
  let end = null, c = null;
  try { if (endRaw) end = JSON.parse(endRaw); } catch { end = null; }
  try { if (cardRaw) c = JSON.parse(cardRaw); } catch { c = null; }
  res.json({
    nome: u.nome, email: u.email,
    cpf: cpf && maskCPF(cpf), telefone: tel && maskPhone(tel), endereco: end,
    cartao: c && { mascara: maskCard(c.numero), titular: c.titular, validade: c.validade }
  });
}));

app.put('/api/perfil', auth, w(async (req, res) => {
  await savePII(req.uid, parsePII(B(req), true));
  res.json({ ok: true });
}));

/* ------------------------------- Produtos ------------------------------- */
app.get('/api/produtos', w(async (req, res) => {
  const rows = await db.all('SELECT id,nome,preco_cents,categoria,estoque,descricao,imagem_url FROM products ORDER BY id');
  res.json({ produtos: rows.map(({ preco_cents, ...p }) => ({ ...p, preco: reais(preco_cents) })) });
}));

app.post('/api/produtos', auth, w(async (req, res) => {
  const b = B(req);
  const nome = clean(b.nome, 80), categoria = clean(b.categoria, 30), descricao = clean(b.descricao, 500);
  const preco = typeof b.preco === 'number' || typeof b.preco === 'string' ? Number(b.preco) : NaN;
  const cents = Math.round(preco * 100), estoque = b.estoque;
  if (nome.length < 3 || categoria.length < 2) throw new HttpErr(400, 'Nome ou categoria inválidos');
  if (!Number.isFinite(cents) || cents < 1 || cents > 10_000_000) throw new HttpErr(400, 'Preço inválido');
  if (!Number.isInteger(estoque) || estoque < 0 || estoque > 9999) throw new HttpErr(400, 'Estoque inválido');
  let img = '';
  if (b.imagem_url) {
    try {
      const u = new URL(String(b.imagem_url).trim());
      if (u.protocol !== 'https:' || String(b.imagem_url).length > 400 || /[\s<>"'[\]]/.test(String(b.imagem_url))) throw 0;
      img = u.href;
    } catch {
      throw new HttpErr(400, 'URL de imagem deve ser https:// válida');
    }
  }
  const sellerCount = await db.get('SELECT COUNT(*) AS n FROM products WHERE seller_id=?', [req.uid]);
  if (sellerCount && sellerCount.n >= 50) throw new HttpErr(429, 'Limite de 50 produtos por vendedor');

  const maxRow = await db.get('SELECT MAX(id) AS m FROM products');
  const nextId = Math.max(1000, Number(maxRow?.m || 999) + 1);

  await db.run(
    'INSERT INTO products(id,nome,preco_cents,categoria,estoque,descricao,imagem_url,seller_id) VALUES(?,?,?,?,?,?,?,?)',
    [nextId, nome, cents, categoria, estoque, descricao, img, req.uid]
  );
  res.status(201).json({ ok: true, id: nextId });
}));

/* ------------------------- Cotação, checkout, pedidos ------------------------- */
app.post('/api/cotacao', w(async (req, res) => {
  const b = B(req);
  const uf = UFS.includes(String(b.uf).toUpperCase()) ? String(b.uf).toUpperCase() : 'SP';
  const q = await price(parseItems(b.itens), uf);
  res.json({ subtotal: reais(q.sub), frete: reais(q.frete), total: reais(q.total), uf });
}));

async function executeCheckoutTx(uid, items, uf, addrEnc) {
  return await db.transaction(async tx => {
    const q = await price(items, uf, tx);
    for (const l of q.lines) {
      const dc = await tx.run('UPDATE products SET estoque=estoque-? WHERE id=? AND estoque>=?', [l.q, l.id, l.q]);
      if (dc.changes !== 1) throw new HttpErr(409, `Estoque insuficiente: ${l.nome}`);
    }
    const orderRes = await tx.run(
      'INSERT INTO orders(user_id,subtotal_cents,frete_cents,total_cents,addr_enc,created) VALUES(?,?,?,?,?,?)',
      [uid, q.sub, q.frete, q.total, addrEnc, Date.now()]
    );
    const oid = orderRes.lastInsertRowid;
    for (const l of q.lines) {
      await tx.run('INSERT INTO order_items(order_id,product_id,nome,qty,unit_cents) VALUES(?,?,?,?,?)', [oid, l.id, l.nome, l.q, l.preco_cents]);
    }
    return { id: oid, total: reais(q.total) };
  });
}

app.post('/api/checkout', auth, w(async (req, res) => {
  const b = B(req);
  const items = parseItems(b.itens);
  if (b.endereco || b.cartao) {
    await savePII(req.uid, parsePII({ endereco: b.endereco, cartao: b.cartao }, true));
  }
  if (typeof b.cvv !== 'string' || !/^\d{3,4}$/.test(b.cvv)) throw new HttpErr(400, 'CVV inválido');
  const u = await db.get('SELECT addr_enc,card_enc FROM users WHERE id=?', [req.uid]);
  const addrDec = u && u.addr_enc ? safeDec(u.addr_enc, `u${req.uid}:endereco`) : null;
  const cardDec = u && u.card_enc ? safeDec(u.card_enc, `u${req.uid}:cartao`) : null;
  if (!addrDec || !cardDec) throw new HttpErr(400, 'Cadastre endereço e cartão para finalizar a compra');
  const card = JSON.parse(cardDec);
  if (!validadeOk(card.validade)) throw new HttpErr(400, 'Cartão vencido');
  const uf = JSON.parse(addrDec).uf;
  const result = await executeCheckoutTx(req.uid, items, uf, u.addr_enc);
  res.status(201).json({ ok: true, ...result });
}));

app.get('/api/pedidos', auth, w(async (req, res) => {
  const rows = await db.all('SELECT id,total_cents,created FROM orders WHERE user_id=? ORDER BY id DESC', [req.uid]);
  res.json({ pedidos: rows.map(o => ({ id: o.id, data: new Date(Number(o.created)).toISOString(), status: deliveryStatus(Number(o.created)), total: reais(o.total_cents) })) });
}));

app.get('/api/pedidos/:id', auth, w(async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) throw new HttpErr(404, 'Pedido não encontrado');
  const o = await db.get('SELECT * FROM orders WHERE id=? AND user_id=?', [Number(req.params.id), req.uid]);
  if (!o) throw new HttpErr(404, 'Pedido não encontrado');
  const itens = await db.all('SELECT nome,qty,unit_cents FROM order_items WHERE order_id=?', [o.id]);
  const addrRaw = safeDec(o.addr_enc, `u${req.uid}:endereco`);
  res.json({
    id: o.id, data: new Date(Number(o.created)).toISOString(), status: deliveryStatus(Number(o.created)),
    itens: itens.map(i => ({ nome: i.nome, quantidade: i.qty, unitario: reais(i.unit_cents) })),
    subtotal: reais(o.subtotal_cents), frete: reais(o.frete_cents), total: reais(o.total_cents),
    endereco: addrRaw ? JSON.parse(addrRaw) : null
  });
}));

/* ------------------------------ Erros ------------------------------ */
app.use('/api', (req, res) => res.status(404).json({ erro: 'Não encontrado' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpErr) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ erro: 'Requisição inválida' });
  console.error(err); // detalhes só no console; o cliente recebe mensagem genérica (sem stack trace)
  res.status(500).json({ erro: 'Erro interno' });
});

setInterval(async () => {
  try {
    await db.run('DELETE FROM sessions WHERE expires<?', [Date.now()]);
    await db.run('DELETE FROM reset_tokens WHERE expires<?', [Date.now()]);
  } catch (err) {
    console.error('[CLEANUP]', err.message);
  }
}, 60_000).unref();

async function startServer() {
  await db.init(catalog);
  return new Promise((resolve, reject) => {
    const s = app.listen(PORT, HOST, () => {
      console.log(`Obsidiana no ar: http://${HOST}:${PORT}`);
      resolve(s);
    });
    s.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Falha ao iniciar servidor:', err);
    process.exit(1);
  });
}

module.exports = { app, db, price, REGION, startServer };
