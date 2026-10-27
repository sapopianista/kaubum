'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 * A02 — Chave AES-256 (env ENC_KEY com 64 hex, ou gerada em data/.enckey)
 * ------------------------------------------------------------------ */
function loadKey(dataDir = path.join(__dirname, '..', 'data')) {
  if (process.env.ENC_KEY) {
    const k = Buffer.from(process.env.ENC_KEY, 'hex');
    if (k.length !== 32) throw new Error('ENC_KEY deve ter 64 caracteres hexadecimais');
    return k;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[AVISO DE SEGURANÇA] Variável de ambiente ENC_KEY não definida em produção. Configure ENC_KEY (64 hex).');
  } else if (process.platform === 'win32' && !process.env.NODE_TEST_CONTEXT) {
    console.warn('[INFO SEGURANÇA] Usando data/.enckey local. No Windows, permissões POSIX (0600) não restringem ACLs NTFS — defina ENC_KEY em produção.');
  }
  const f = path.join(dataDir, '.enckey');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) {
    const raw = fs.readFileSync(f, 'utf8').trim();
    const k = Buffer.from(raw, 'hex');
    if (k.length === 32) return k;
  }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}

const KEY = loadKey();

// AES-256-GCM. O AAD amarra o texto cifrado ao usuário e ao campo:
// copiar o CPF cifrado de um usuário para outro falha na autenticação.
function enc(plain, aad, key = KEY) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aad), 'utf8'));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.');
}

function dec(s, aad, key = KEY) {
  if (typeof s !== 'string') throw new Error('Texto cifrado ausente ou inválido');
  const parts = s.split('.');
  if (parts.length !== 3) throw new Error('Formato de texto cifrado inválido');
  const [iv, tag, ct] = parts.map(x => Buffer.from(x, 'base64'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('IV ou AuthTag inválidos');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(String(aad), 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Blindagem contra falha de descriptografia: evita derrubar a rota com erro 500 se a chave mudou ou dado corrompeu
function safeDec(s, aad, key = KEY) {
  if (!s) return null;
  try {
    return dec(s, aad, key);
  } catch (err) {
    console.warn(`[ALERTA CRIPTO] Falha ao decifrar campo (${aad}): ${err.message}`);
    return null;
  }
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

module.exports = { KEY, loadKey, enc, dec, safeDec, sha };

