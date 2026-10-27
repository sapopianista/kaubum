'use strict';
const path = require('path');
const fs = require('fs');

const DB_CLIENT = process.env.DB_CLIENT || 'mysql'; // 'mysql' (padrão para Workbench) ou 'sqlite'

let driver = null;

if (DB_CLIENT === 'mysql') {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'aluno',
    database: process.env.DB_NAME || 'kaubum',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  driver = {
    type: 'mysql',
    async get(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows && rows.length > 0 ? rows[0] : null;
    },
    async all(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return rows || [];
    },
    async run(sql, params = []) {
      const [res] = await pool.execute(sql, params);
      return {
        lastInsertRowid: Number(res.insertId),
        changes: res.affectedRows
      };
    },
    async transaction(callback) {
      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        const txDb = {
          async get(sql, params = []) {
            const [rows] = await conn.execute(sql, params);
            return rows && rows.length > 0 ? rows[0] : null;
          },
          async all(sql, params = []) {
            const [rows] = await conn.execute(sql, params);
            return rows || [];
          },
          async run(sql, params = []) {
            const [res] = await conn.execute(sql, params);
            return {
              lastInsertRowid: Number(res.insertId),
              changes: res.affectedRows
            };
          }
        };
        const result = await callback(txDb);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
    async init(catalog) {
      // Criação das tabelas no MySQL se não existirem
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          nome VARCHAR(100) NOT NULL,
          pass_hash VARCHAR(255) NOT NULL,
          cpf_enc TEXT,
          phone_enc TEXT,
          addr_enc TEXT,
          card_enc TEXT,
          created BIGINT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id_hash VARCHAR(64) PRIMARY KEY,
          user_id INT NOT NULL,
          expires BIGINT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
          token_hash VARCHAR(64) PRIMARY KEY,
          user_id INT NOT NULL,
          expires BIGINT NOT NULL,
          used INT NOT NULL DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id INT PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          preco_cents INT NOT NULL,
          categoria VARCHAR(50) NOT NULL,
          estoque INT NOT NULL,
          descricao TEXT,
          imagem_url TEXT,
          seller_id INT,
          FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          subtotal_cents INT NOT NULL,
          frete_cents INT NOT NULL,
          total_cents INT NOT NULL,
          addr_enc TEXT NOT NULL,
          created BIGINT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          order_id INT NOT NULL,
          product_id INT NOT NULL,
          nome VARCHAR(100) NOT NULL,
          qty INT NOT NULL,
          unit_cents INT NOT NULL,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      // Semeia produtos do catálogo
      const seedSql = `
        INSERT INTO products(id,nome,preco_cents,categoria,estoque,descricao,imagem_url,seller_id)
        VALUES(?,?,?,?,?,?,?,NULL)
        ON DUPLICATE KEY UPDATE
          nome=VALUES(nome), preco_cents=VALUES(preco_cents),
          categoria=VALUES(categoria), estoque=VALUES(estoque),
          descricao=VALUES(descricao), imagem_url=VALUES(imagem_url)
      `;
      for (const p of catalog) {
        await pool.execute(seedSql, [
          p.id,
          p.nome,
          Math.round(p.preco * 100),
          p.categoria,
          p.estoque,
          p.descricao || '',
          p.imagem_url || ''
        ]);
      }
      console.log(`[BANCO] Conectado ao MySQL com sucesso (banco: ${process.env.DB_NAME || 'kaubum'})`);
    },
    async close() {
      await pool.end();
    }
  };
} else {
  // Modo SQLite (para testes automatizados rápidos ou fallback)
  const Database = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'loja.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sdb = new Database(dbPath);
  sdb.pragma('journal_mode = WAL');
  sdb.pragma('foreign_keys = ON');

  driver = {
    type: 'sqlite',
    async get(sql, params = []) {
      return sdb.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return sdb.prepare(sql).all(...params) || [];
    },
    async run(sql, params = []) {
      const res = sdb.prepare(sql).run(...params);
      return {
        lastInsertRowid: Number(res.lastInsertRowid),
        changes: res.changes
      };
    },
    async transaction(callback) {
      sdb.exec('BEGIN');
      try {
        const res = await callback(driver);
        sdb.exec('COMMIT');
        return res;
      } catch (err) {
        sdb.exec('ROLLBACK');
        throw err;
      }
    },
    async init(catalog) {
      sdb.exec(`
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
      const seed = sdb.prepare(`
        INSERT INTO products(id,nome,preco_cents,categoria,estoque,descricao,imagem_url,seller_id)
        VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, preco_cents=excluded.preco_cents,
        categoria=excluded.categoria, estoque=excluded.estoque, descricao=excluded.descricao, imagem_url=excluded.imagem_url
        WHERE products.seller_id IS NULL
      `);
      for (const p of catalog) {
        seed.run(p.id, p.nome, Math.round(p.preco * 100), p.categoria, p.estoque, p.descricao || '', p.imagem_url || '');
      }
      console.log(`[BANCO] Conectado ao SQLite (path: ${dbPath})`);
    },
    async close() {
      sdb.close();
    }
  };
}

module.exports = driver;
