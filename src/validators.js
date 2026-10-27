'use strict';

class HttpErr extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 * Validação / sanitização (A03)
 * Normaliza Unicode (NFKC) e remove caracteres de controle ASCII,
 * controles C1 (\u007f-\u009f), caracteres Bidi (\u200e-\u2069) e < >
 * ------------------------------------------------------------------ */
const CTRL_AND_BIDI_RE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>]/g;

const clean = (s, max) =>
  typeof s === 'string'
    ? s.normalize('NFKC').replace(CTRL_AND_BIDI_RE, '').trim().slice(0, max)
    : '';

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const B = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

function normEmail(e) {
  if (typeof e !== 'string') return null;
  e = e.normalize('NFKC').trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return null;
  // Rejeita controles, espaços, múltiplos @ ou pontos consecutivos inválidos no domínio
  if (!/^[^\s@<>[\]()\\,;:"']+@[^\s@<>[\]()\\,;:"'.]+(\.[^\s@<>[\]()\\,;:"'.]+)+$/.test(e)) return null;
  return e;
}

const strongPw = s =>
  typeof s === 'string' &&
  s.length >= 10 &&
  s.length <= 72 &&
  /[a-z]/.test(s) &&
  /[A-Z]/.test(s) &&
  /\d/.test(s);

function validCPF(c) {
  c = String(c ?? '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

function luhn(n) {
  if (typeof n !== 'string' || !/^\d{13,19}$/.test(n)) return false;
  let s = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    s += d;
    alt = !alt;
  }
  return s % 10 === 0;
}

const validadeOk = v =>
  typeof v === 'string' &&
  /^(0[1-9]|1[0-2])\/\d{2}$/.test(v) &&
  new Date(2000 + Number(v.slice(3)), Number(v.slice(0, 2)), 1) > new Date();

function parseAddr(e) {
  if (!e || typeof e !== 'object') throw new HttpErr(400, 'Endereço inválido');
  const a = {
    cep: String(e.cep ?? '').replace(/\D/g, ''),
    rua: clean(e.rua, 80),
    numero: clean(e.numero, 10),
    complemento: clean(e.complemento, 40),
    bairro: clean(e.bairro, 60),
    cidade: clean(e.cidade, 60),
    uf: clean(e.uf, 2).toUpperCase()
  };
  if (
    !/^\d{8}$/.test(a.cep) ||
    a.rua.length < 3 ||
    !a.numero ||
    a.bairro.length < 2 ||
    a.cidade.length < 2 ||
    !UFS.includes(a.uf)
  ) {
    throw new HttpErr(400, 'Endereço incompleto ou inválido');
  }
  return a;
}

function parseCard(c) {
  if (!c || typeof c !== 'object') throw new HttpErr(400, 'Dados de cartão inválidos');
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

// A02 — máscaras: o front nunca recebe CPF/cartão completos
const maskCPF = c => `***.***.***-${String(c).slice(-2)}`;
const maskCard = n => `**** **** **** ${String(n).slice(-4)}`;
const maskPhone = t => `(**) *****-${String(t).slice(-4)}`;

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) throw new HttpErr(400, 'Carrinho inválido');
  const m = new Map();
  for (const it of raw) {
    // Qualquer campo "preco" enviado pelo cliente é simplesmente ignorado.
    if (!it || typeof it !== 'object' || !Number.isInteger(it.id) || it.id < 1 || !Number.isInteger(it.quantidade) || it.quantidade < 1) {
      throw new HttpErr(400, 'Item inválido');
    }
    m.set(it.id, (m.get(it.id) || 0) + it.quantidade);
  }
  for (const q of m.values()) {
    if (q > 20) throw new HttpErr(400, 'Máximo de 20 unidades por produto');
  }
  return [...m].map(([id, q]) => ({ id, q }));
}

module.exports = {
  HttpErr,
  clean,
  UFS,
  B,
  normEmail,
  strongPw,
  validCPF,
  luhn,
  validadeOk,
  parseAddr,
  parseCard,
  parsePII,
  maskCPF,
  maskCard,
  maskPhone,
  parseItems
};

