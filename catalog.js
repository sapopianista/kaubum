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
  { id: 1,  nome: 'Teclado Mecânico Nox 75',   preco: 549.9,  categoria: 'Periféricos', estoque: 12, descricao: 'Layout 75%, switches lineares silenciosos e retroiluminação âmbar suave.', imagem_url: 'https://images.unsplash.com/photo-1595225476474-87563907a212?w=600&q=80](https://images.unsplash.com/photo-1595225476474-87563907a212?w=600&q=80' },
  { id: 2,  nome: 'Mouse Vetor Ultraleve',     preco: 289.0,  categoria: 'Periféricos', estoque: 25, descricao: '58 g, sensor de 26.000 DPI e receptor 2.4 GHz.', imagem_url: 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&q=80](https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&q=80' },
  { id: 3,  nome: 'Monitor Eclipse 27" QHD',   preco: 1899.0, categoria: 'Periféricos',       estoque: 6,  descricao: 'IPS 165 Hz, modo noturno de fábrica e base ajustável.', imagem_url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&q=80](https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&q=80' },
  { id: 4,  nome: 'Perfume de Masculino - WD40', preco: 329.0, categoria: 'Perfumaria',     estoque: 3,  descricao: 'Perfume de nicho intenso, alta projeção e fixação cheiro amadeirado ideal para saídas noturnas e encontros.', imagem_url: 'https://i.pinimg.com/736x/79/c7/69/79c7690561b582eb4547f1c878459435.jpg' },
  { id: 5,  nome: 'Headphone Calmaria ANC',    preco: 799.9,  categoria: 'Periféricos',       estoque: 15, descricao: 'Cancelamento de ruído ativo e 40 h de bateria.', imagem_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80](https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80' },
  { id: 6,  nome: 'Perfume Masculino - Whatsapp',         preco: 249.0,  categoria: 'Perfumaria',       estoque: 30, descricao: 'Perfume refrescante para de fácil agrabilidade, ideal para dias de calor intenso, academia, etc.', imagem_url: 'https://i.pinimg.com/1200x/03/71/b9/0371b99799187bbb428ab7c49130c9ce.jpg' },
  { id: 7,  nome: 'Vaso Sanitário Móvel',   preco: 1709.9,  categoria: 'Veículos',    estoque: 20, descricao: 'Patinete com assento sanitário, ideal para quem tem incontinência urinária, está com dor de barriga entre outros e necessita se locomover com facilidade.', imagem_url: 'https://i.pinimg.com/1200x/70/45/cf/7045cfbeaa972efc068c22ffa0fb9fa9.jpg' },
  { id: 8,  nome: 'Controle de Vídeo Game',         preco: 219.0,  categoria: 'Periféricos',    estoque: 14, descricao: 'Controle Xbox/PS4/PS5/PC com fio 5 marchas ideal para jogos de corrida.', imagem_url: 'https://i.pinimg.com/1200x/98/91/cf/9891cff90cc84357ff7826be73a9a222.jpg' },
  { id: 9,  nome: 'Calça Social Masculina',      preco: 1499.0, categoria: 'Vestuário',  estoque: 5,  descricao: 'Calça social masculina cintura alta caqui.', imagem_url: 'https://i.pinimg.com/736x/ed/59/a0/ed59a0cd9ae1adf0eda0f8400ff64980.jpg' },
  { id: 10, nome: 'Bicicleta Vegana',      preco: 2190.0, categoria: 'Veículos',  estoque: 4,  descricao: 'Bicicleta orgânica, feita restos de poda de árvores.', imagem_url: 'https://i.pinimg.com/736x/06/a1/60/06a1604d49b137b4d4b25fcef17f66ed.jpg' },
  { id: 11, nome: 'Bicicleta Adaptada',          preco: 329.0,  categoria: 'Veículos',  estoque: 40, descricao: 'Bicicleta com banco adaptado para maior conforto durante a pedalada.', imagem_url: 'https://i.pinimg.com/736x/03/e5/9f/03e59f7a3d4150359d69c23e4b95817d.jpg' },
  { id: 12, nome: 'Carrinho de Mão Esportivo',      preco: 399.0,  categoria: 'Veículos',  estoque: 18, descricao: 'Carrinho de mão esportivo equipado com freio ABS.', imagem_url: 'https://i.pinimg.com/1200x/d4/a9/12/d4a912744c140965a56d64b4d1426204.jpg' }
];
