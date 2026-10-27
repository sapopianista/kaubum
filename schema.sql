-- Script DDL para criação da base de dados no MySQL Workbench
CREATE DATABASE IF NOT EXISTS kaubum CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kaubum;

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
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  expires BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  expires BIGINT NOT NULL,
  used INT NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  subtotal_cents INT NOT NULL,
  frete_cents INT NOT NULL,
  total_cents INT NOT NULL,
  addr_enc TEXT NOT NULL,
  created BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  nome VARCHAR(100) NOT NULL,
  qty INT NOT NULL,
  unit_cents INT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

