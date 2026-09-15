-- Clientes (especificação §4.5)
create table clientes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  tipo_pessoa           tipo_pessoa not null default 'fisica',
  cpf_cnpj              text unique,
  email                 text,
  telefone              text,
  cidade                text,
  uf                    char(2),
  advogado_indicacao_id uuid references advogados(id),
  percentual_indicacao  numeric(6,3) default 0
                          check (percentual_indicacao between 0 and 100),
  origem                text,
  data_cadastro         date not null default current_date,
  observacao            text,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  criado_por            uuid references usuarios(id),
  atualizado_em         timestamptz,
  atualizado_por        uuid references usuarios(id)
);
create index idx_clientes_busca on clientes
  using gin (to_tsvector('portuguese', nome || ' ' || coalesce(cpf_cnpj,'')));
create index idx_clientes_indicacao on clientes (advogado_indicacao_id);
create index idx_clientes_criado_por     on clientes (criado_por);
create index idx_clientes_atualizado_por on clientes (atualizado_por);

-- Processos (especificação §4.6, opcional/recomendado)
create table processos (
  id                 uuid primary key default gen_random_uuid(),
  numero_cnj         text unique,
  cliente_id         uuid not null references clientes(id),
  tipo_processo_id   uuid not null references tipos_processo(id),
  comarca            text,
  vara               text,
  valor_causa        numeric(14,2),
  data_distribuicao  date,
  encerrado          boolean not null default false
);
create index idx_processos_cliente on processos (cliente_id);
create index idx_processos_tipo    on processos (tipo_processo_id);
