'use strict';
/**
 * CATÁLOGO INICIAL — edite à vontade!
 *
 * Campos:
 *   id          número inteiro ÚNICO entre 1 e 999 (produtos criados pelos usuários usam ids >= 1000)
 *   nome        3 a 80 caracteres
 *   preco       em reais (ex.: 349.9). O servidor converte para centavos.
 *   categoria   texto livre; vira um filtro na vitrine
 *   estoque     inteiro >= 0 (volta ao valor daqui sempre que o servidor reinicia)
 *   descricao   até 500 caracteres
 *   imagem_url  "" (mostra um monograma) OU uma URL https:// de imagem
 *
 * Para adicionar um produto: copie uma linha, troque o id e reinicie o servidor.
 */
module.exports = [
  { id: 1,  nome: 'Teclado Mecânico Nox 75',   preco: 549.9,  categoria: 'Periféricos', estoque: 12, descricao: 'Layout 75%, switches lineares silenciosos e retroiluminação âmbar suave.', imagem_url: '' },
  { id: 2,  nome: 'Mouse Vetor Ultraleve',     preco: 289.0,  categoria: 'Periféricos', estoque: 25, descricao: '58 g, sensor de 26.000 DPI e receptor 2.4 GHz.', imagem_url: '' },
  { id: 3,  nome: 'Monitor Eclipse 27" QHD',   preco: 1899.0, categoria: 'Telas',       estoque: 6,  descricao: 'IPS 165 Hz, modo noturno de fábrica e base ajustável.', imagem_url: '' },
  { id: 4,  nome: 'Monitor Umbra 34" Ultrawide', preco: 3299.0, categoria: 'Telas',     estoque: 3,  descricao: 'Curvo 1500R, 100 Hz, USB-C com 90 W de carga.', imagem_url: '' },
  { id: 5,  nome: 'Headphone Calmaria ANC',    preco: 799.9,  categoria: 'Áudio',       estoque: 15, descricao: 'Cancelamento de ruído ativo e 40 h de bateria.', imagem_url: '' },
  { id: 6,  nome: 'Caixa Órbita Mini',         preco: 249.0,  categoria: 'Áudio',       estoque: 30, descricao: 'Bluetooth 5.3, à prova d\'água IP67.', imagem_url: '' },
  { id: 7,  nome: 'Luminária Lunar de Mesa',   preco: 179.9,  categoria: 'Ambiente',    estoque: 20, descricao: 'Temperatura de cor ajustável e luz sem tremulação.', imagem_url: '' },
  { id: 8,  nome: 'Barra de Luz Halo',         preco: 219.0,  categoria: 'Ambiente',    estoque: 14, descricao: 'Ilumina o teclado sem refletir na tela.', imagem_url: '' },
  { id: 9,  nome: 'Cadeira Vigília Ergo',      preco: 1499.0, categoria: 'Mobiliário',  estoque: 5,  descricao: 'Apoio lombar dinâmico e braços 4D.', imagem_url: '' },
  { id: 10, nome: 'Mesa Regulável Cinza',      preco: 2190.0, categoria: 'Mobiliário',  estoque: 4,  descricao: 'Motor duplo, memória para 4 alturas.', imagem_url: '' },
  { id: 11, nome: 'Hub USB-C 9 em 1',          preco: 329.0,  categoria: 'Acessórios',  estoque: 40, descricao: 'HDMI 4K, leitor SD, 2 USB-A e Ethernet gigabit.', imagem_url: '' },
  { id: 12, nome: 'Mochila Noturna 22 L',      preco: 399.0,  categoria: 'Acessórios',  estoque: 18, descricao: 'Compartimento para notebook de 16" e zíperes ocultos.', imagem_url: '' }
];
