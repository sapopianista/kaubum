'use strict';
process.env.DB_CLIENT = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.BCRYPT_ROUNDS = '4';
process.env.NODE_TEST_CONTEXT = '1';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const catalog = require('../catalog');
const { enc, dec, safeDec } = require('../src/crypto');
const {
  clean, normEmail, strongPw, validCPF, luhn, validadeOk, parseItems, maskCPF, maskCard
} = require('../src/validators');
const { app, db } = require('../server');

describe('1. Catálogo de Produtos (catalog.js)', () => {
  it('todos os produtos possuem IDs válidos e URLs https:// íntegras sem lixo Markdown', () => {
    for (const p of catalog) {
      assert.ok(Number.isInteger(p.id) && p.id >= 1 && p.id <= 999, `ID inválido: ${p.id}`);
      assert.ok(p.preco > 0, `Preço inválido em ${p.nome}`);
      if (p.imagem_url) {
        const u = new URL(p.imagem_url);
        assert.equal(u.protocol, 'https:');
        assert.ok(!/[\s<>[\]()]/.test(p.imagem_url), `URL contém caracteres inválidos: ${p.imagem_url}`);
      }
    }
  });
});

describe('2. Criptografia AES-256-GCM e Blindagem (src/crypto.js)', () => {
  it('cifra e decifra corretamente quando o AAD coincide', () => {
    const cipher = enc('52998224725', 'u1:cpf');
    assert.notEqual(cipher, '52998224725');
    assert.equal(dec(cipher, 'u1:cpf'), '52998224725');
  });

  it('rejeita adulteração de AAD (troca de contexto entre usuários)', () => {
    const cipher = enc('52998224725', 'u1:cpf');
    assert.throws(() => dec(cipher, 'u2:cpf'));
  });

  it('safeDec retorna null silenciosamente em caso de chave incorreta ou dado corrompido', () => {
    const cipher = enc('segredo', 'u1:cpf');
    const wrongKey = crypto.randomBytes(32);
    assert.equal(safeDec(cipher, 'u1:cpf', wrongKey), null);
    assert.equal(safeDec('dado.corrompido.invalido', 'u1:cpf'), null);
  });
});

describe('3. Validadores e Sanitização (src/validators.js)', () => {
  it('clean remove caracteres de controle ASCII, Bidi Unicode e tags HTML', () => {
    const dirty = '  Teclado\u202e<script>\u0000Pro  ';
    assert.equal(clean(dirty, 50), 'TecladoscriptPro');
  });

  it('normEmail valida e normaliza e-mails corretamente', () => {
    assert.equal(normEmail('  Aluno@Escola.EDU.BR '), 'aluno@escola.edu.br');
    assert.equal(normEmail('invalido@@dominio.com'), null);
    assert.equal(normEmail('sem-arroba.com'), null);
    assert.equal(normEmail('a@b..com'), null);
  });

  it('strongPw exige 10..72 chars com maiúscula, minúscula e dígito', () => {
    assert.equal(strongPw('SenhaForte123'), true);
    assert.equal(strongPw('curta1A'), false);
    assert.equal(strongPw('semmaiuscula123'), false);
    assert.equal(strongPw('SEMNUMEROAQUI'), false);
  });

  it('validCPF valida dígitos verificadores e rejeita sequências repetidas', () => {
    assert.equal(validCPF('52998224725'), true);
    assert.equal(validCPF('111.111.111-11'), false);
    assert.equal(validCPF('52998224720'), false);
  });

  it('luhn valida cartões de crédito e máscara oculta PAN', () => {
    assert.equal(luhn('4532015112830366'), true);
    assert.equal(luhn('4532015112830367'), false);
    assert.equal(maskCard('4532015112830366'), '**** **** **** 0366');
    assert.equal(maskCPF('52998224725'), '***.***.***-25');
  });

  it('validadeOk aceita datas futuras e rejeita vencidas', () => {
    assert.equal(validadeOk('12/99'), true);
    assert.equal(validadeOk('01/20'), false);
  });

  it('parseItems ignora preço enviado pelo cliente e limita quantidade', () => {
    const items = parseItems([{ id: 1, quantidade: 2, preco: 0.01 }, { id: 1, quantidade: 3 }]);
    assert.deepEqual(items, [{ id: 1, q: 5 }]);
    assert.throws(() => parseItems([{ id: 1, quantidade: 25 }]), /Máximo de 20/);
  });
});

describe('4. Integração HTTP & Fluxo Completo de E-commerce (server.js)', () => {
  let server;
  let baseUrl;
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

  async function req(path, { method = 'GET', body, csrf = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const ck = cookieHeader();
    if (ck) headers.Cookie = ck;
    if (csrf && jar.has('csrf')) headers['X-CSRF-Token'] = jar.get('csrf');
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    updateCookies(res);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, headers: res.headers, data };
  }

  before(async () => {
    await db.init(catalog);
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db && typeof db.close === 'function') await db.close();
  });

  it('aplica cabeçalhos de segurança CSP e Permissions-Policy e emite cookie CSRF', async () => {
    const r = await req('/api/produtos');
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-security-policy')?.includes("default-src 'none'"));
    assert.ok(r.headers.get('permissions-policy')?.includes('camera=()'));
    assert.ok(jar.has('csrf'));
    assert.equal(r.data.produtos.length, catalog.length);
  });

  it('bloqueia requisições POST sem token CSRF válido', async () => {
    const r = await req('/api/cotacao', {
      method: 'POST',
      csrf: false,
      body: { itens: [{ id: 1, quantidade: 1 }], uf: 'SP' }
    });
    assert.equal(r.status, 403);
  });

  it('realiza cadastro, login, consulta de perfil mascarado e checkout contínuo', async () => {
    const reg = await req('/api/register', {
      method: 'POST',
      body: {
        nome: 'Maria Teste',
        email: 'maria@teste.com.br',
        senha: 'SenhaForte123',
        cpf: '52998224725',
        telefone: '11988887777',
        endereco: {
          cep: '01001000',
          rua: 'Praça da Sé',
          numero: '100',
          complemento: 'Lado Ímpar',
          bairro: 'Sé',
          cidade: 'São Paulo',
          uf: 'SP'
        }
      }
    });
    assert.equal(reg.status, 201);

    const login = await req('/api/login', {
      method: 'POST',
      body: { email: 'maria@teste.com.br', senha: 'SenhaForte123' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.nome, 'Maria Teste');

    const perfil = await req('/api/perfil');
    assert.equal(perfil.status, 200);
    assert.equal(perfil.data.cpf, '***.***.***-25');
    assert.equal(perfil.data.telefone, '(**) *****-7777');
    assert.equal(perfil.data.endereco.uf, 'SP');

    // Checkout enviando o cartão diretamente no fluxo contínuo
    const checkout = await req('/api/checkout', {
      method: 'POST',
      body: {
        itens: [{ id: 1, quantidade: 1 }],
        cvv: '123',
        cartao: {
          numero: '4532015112830366',
          validade: '12/99',
          titular: 'MARIA TESTE'
        }
      }
    });
    assert.equal(checkout.status, 201);
    assert.ok(checkout.data.id >= 1);

    const pedidos = await req('/api/pedidos');
    assert.equal(pedidos.status, 200);
    assert.equal(pedidos.data.pedidos.length, 1);

    // Logout global de sessões
    const out = await req('/api/logout-all', { method: 'POST' });
    assert.equal(out.status, 200);

    const sessAfter = await req('/api/sessao');
    assert.equal(sessAfter.data.logado, false);
  });
});
