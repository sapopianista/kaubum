'use strict';
/**
 * CATÁLOGO INICIAL — Produtos genéricos corporativos e de tecnologia
 *
 * Campos:
 *   id          número inteiro ÚNICO entre 1 e 999 (produtos criados pelos usuários usam ids >= 1000)
 *   nome        3 a 80 caracteres
 *   preco       em reais (ex.: 349.9). O servidor converte para centavos.
 *   categoria   texto livre; vira um filtro na vitrine
 *   estoque     inteiro >= 0 (volta ao valor daqui sempre que o servidor reinicia)
 *   descricao   até 500 caracteres
 *   imagem_url  "" (mostra um monograma) OU uma URL https:// de imagem
 */
module.exports = [
  {
    id: 1,
    nome: 'Pacote de Papel A4 Reciclado 500fls',
    preco: 32.9,
    categoria: 'Papelaria',
    estoque: 40,
    descricao: 'Resma de papel sulfite formato A4 75g/m² produzida com fibras 100% recicladas para impressão diária.',
    imagem_url: 'https://images.unsplash.com/photo-1586075010923-2dd4570fb338?w=600&q=80'
  },
  {
    id: 2,
    nome: 'Hub USB 4 Portas 3.0 SuperSpeed',
    preco: 69.9,
    categoria: 'Periféricos',
    estoque: 25,
    descricao: 'Expansor compacto com 4 portas USB 3.0 de até 5 Gbps, compatível com Windows, Linux e macOS.',
    imagem_url: 'https://images.unsplash.com/photo-1625842268584-8f3296236761?w=600&q=80'
  },
  {
    id: 3,
    nome: 'Organizador de Mesa Modular com Gavetas',
    preco: 89.0,
    categoria: 'Organização',
    estoque: 18,
    descricao: 'Estrutura em ABS resistente com divisórias para documentos, blocos de notas e compartimento deslizante.',
    imagem_url: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=600&q=80'
  },
  {
    id: 4,
    nome: 'Luminária de Mesa LED Articulada',
    preco: 124.5,
    categoria: 'Iluminação',
    estoque: 15,
    descricao: 'Três níveis de temperatura de cor (3000K a 6000K), braço metálico ajustável e base antiderrapante.',
    imagem_url: 'https://images.unsplash.com/photo-1534105615256-13940a56ff44?w=600&q=80'
  },
  {
    id: 5,
    nome: 'Fone de Ouvido Estéreo On-Ear P3',
    preco: 45.0,
    categoria: 'Eletrônicos',
    estoque: 30,
    descricao: 'Headset leve com almofadas acústicas macias, microfone integrado no cabo e conector único de 3.5mm.',
    imagem_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80'
  },
  {
    id: 6,
    nome: 'Suporte Ergonômico para Monitor',
    preco: 149.9,
    categoria: 'Mobiliário',
    estoque: 12,
    descricao: 'Base elevada com regulagem de altura em 3 níveis para correção postural e espaço inferior para teclado.',
    imagem_url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&q=80'
  },
  {
    id: 7,
    nome: 'Teclado Padrão ABNT2 USB Silencioso',
    preco: 79.9,
    categoria: 'Informática',
    estoque: 22,
    descricao: 'Teclas de perfil baixo resistentes a respingos, layout brasileiro ABNT2 com tecla Ç e cabo de 1,5m.',
    imagem_url: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&q=80'
  },
  {
    id: 8,
    nome: 'Mouse Óptico Ergonômico 1600 DPI',
    preco: 49.9,
    categoria: 'Informática',
    estoque: 35,
    descricao: 'Design ambidestro confortável para uso prolongado, sensor óptico de alta precisão e conexão plug-and-play.',
    imagem_url: 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=600&q=80'
  },
  {
    id: 9,
    nome: 'Caixa Organizadora Empilhável 30L',
    preco: 58.0,
    categoria: 'Organização',
    estoque: 20,
    descricao: 'Caixa plástica reforçada com travas laterais de segurança para arquivo morto e suprimentos de escritório.',
    imagem_url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=600&q=80'
  },
  {
    id: 10,
    nome: 'Filtro de Linha Bivolt 6 Tomadas DPS',
    preco: 62.9,
    categoria: 'Acessórios',
    estoque: 28,
    descricao: 'Proteção contra surtos elétricos com disjuntor rearmável, gabinete antichamas e tomadas padrão NBR 14136.',
    imagem_url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&q=80'
  },
  {
    id: 11,
    nome: 'Kit Canetas Esferográficas 1.0mm (12 un)',
    preco: 24.0,
    categoria: 'Papelaria',
    estoque: 50,
    descricao: 'Conjunto com 12 canetas de escrita macia (azul, preta e vermelha), corpo sextavado transparente.',
    imagem_url: 'https://images.unsplash.com/photo-1585336261022-680e295ce3fe?w=600&q=80'
  },
  {
    id: 12,
    nome: 'Apoio Ergonômico para Pés com Regulagem',
    preco: 115.0,
    categoria: 'Mobiliário',
    estoque: 10,
    descricao: 'Plataforma inclinável com superfície texturizada antiderrapante que melhora a circulação durante o trabalho.',
    imagem_url: 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?w=600&q=80'
  }
];
