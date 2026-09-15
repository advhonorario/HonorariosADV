-- Cadastro de advogados (especificação §4.3)
-- Criado antes de `usuarios` porque `usuarios.advogado_id` referencia esta tabela.
create table advogados (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  oab_numero         text,
  oab_uf             char(2),
  cpf_cnpj           text unique,
  email              text,
  telefone           text,
  percentual_padrao  numeric(6,3) not null default 0
                       check (percentual_padrao >= 0 and percentual_padrao <= 100),
  papel_preferencial papel_rateio not null default 'responsavel',
  chave_pix          text,
  banco              text,
  agencia            text,
  conta              text,
  observacao         text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  criado_por         uuid,
  atualizado_em      timestamptz,
  atualizado_por     uuid
);
create index idx_advogados_ativo on advogados (ativo, nome);

-- Usuários e perfis (especificação §4.2)
create table usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  perfil      perfil_usuario not null default 'leitura',
  advogado_id uuid references advogados(id),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index idx_usuarios_advogado on usuarios (advogado_id);

-- `criado_por`/`atualizado_por` de `advogados` só podem referenciar `usuarios` depois que ela existe.
alter table advogados
  add constraint fk_advogados_criado_por    foreign key (criado_por)    references usuarios(id),
  add constraint fk_advogados_atualizado_por foreign key (atualizado_por) references usuarios(id);
create index idx_advogados_criado_por     on advogados (criado_por);
create index idx_advogados_atualizado_por on advogados (atualizado_por);

-- Tipos de processo e de serviço (especificação §4.4)
create table tipos_processo (
  id       uuid primary key default gen_random_uuid(),
  codigo   text not null unique,
  nome     text not null,
  area     text not null,
  ativo    boolean not null default true,
  ordem    smallint not null default 0
);

create table tipos_servico (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  nome                text not null,
  natureza            natureza_servico not null,
  percentual_sugerido numeric(6,3) check (percentual_sugerido between 0 and 100),
  ativo               boolean not null default true,
  ordem               smallint not null default 0
);

-- Percentual por combinação advogado × processo × serviço (especificação §4.4)
create table advogado_percentual (
  id               uuid primary key default gen_random_uuid(),
  advogado_id      uuid not null references advogados(id) on delete cascade,
  tipo_processo_id uuid references tipos_processo(id),
  tipo_servico_id  uuid references tipos_servico(id),
  percentual       numeric(6,3) not null check (percentual between 0 and 100),
  ativo            boolean not null default true,
  unique (advogado_id, tipo_processo_id, tipo_servico_id)
);
create index idx_advogado_percentual_tipo_processo on advogado_percentual (tipo_processo_id);
create index idx_advogado_percentual_tipo_servico  on advogado_percentual (tipo_servico_id);
