-- Seed mínimo de desenvolvimento (especificação §12, §15 item 3).
-- Códigos exigidos literalmente pela especificação; nomes, área/natureza e
-- percentual sugerido são valores de exemplo plausíveis, não definitivos —
-- a lista real fica pendente para a v1.1 (especificação §15).

insert into tipos_processo (codigo, nome, area, ordem) values
  ('TRAB','Trabalhista',    'Direito do Trabalho',    1),
  ('CIV', 'Cível',          'Direito Civil',          2),
  ('PREV','Previdenciário', 'Direito Previdenciário', 3),
  ('TRIB','Tributário',     'Direito Tributário',     4),
  ('FAM', 'Família',        'Direito de Família',     5),
  ('CRIM','Criminal',       'Direito Penal',          6),
  ('CONS','Consumidor',     'Direito do Consumidor',  7),
  ('EMP', 'Empresarial',    'Direito Empresarial',    8);

insert into tipos_servico (codigo, nome, natureza, percentual_sugerido, ordem) values
  ('EXITO',      'Honorários de Êxito',             'exito',      30.000, 1),
  ('CONTRATUAL', 'Honorários Contratuais',          'fixo',       30.000, 2),
  ('HORA',       'Honorários por Hora',             'hora',       40.000, 3),
  ('MENSAL',     'Honorários Mensais (Assessoria)', 'mensal',     25.000, 4),
  ('PARECER',    'Parecer / Consultoria',           'consultivo', 50.000, 5);
