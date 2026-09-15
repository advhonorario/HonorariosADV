-- Lançamentos e rateio (especificação §4.7)
create table lancamentos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,
  data_competencia date not null default current_date,
  data_pagamento   date,
  cliente_id       uuid not null references clientes(id),
  processo_id      uuid references processos(id),
  tipo_processo_id uuid not null references tipos_processo(id),
  tipo_servico_id  uuid not null references tipos_servico(id),
  descricao        text,
  valor_bruto      numeric(14,2) not null check (valor_bruto > 0),
  valor_base       numeric(14,2) not null check (valor_base > 0),
  forma_pagamento  text,
  status           status_lancamento not null default 'confirmado',
  observacao       text,
  estornado_em     timestamptz,
  estornado_por    uuid references usuarios(id),
  motivo_estorno   text,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references usuarios(id),
  atualizado_em    timestamptz,
  atualizado_por   uuid references usuarios(id),
  constraint chk_lanc_base_menor_igual_bruto check (valor_base <= valor_bruto)
);
create index idx_lanc_periodo        on lancamentos (data_competencia desc) where status <> 'estornado';
create index idx_lanc_cliente        on lancamentos (cliente_id, data_competencia desc);
create index idx_lanc_status         on lancamentos (status, data_competencia desc);
create index idx_lanc_tipo_processo  on lancamentos (tipo_processo_id);
create index idx_lanc_tipo_servico   on lancamentos (tipo_servico_id);
create index idx_lanc_processo       on lancamentos (processo_id);
create index idx_lanc_criado_por     on lancamentos (criado_por);
create index idx_lanc_atualizado_por on lancamentos (atualizado_por);
create index idx_lanc_estornado_por  on lancamentos (estornado_por);

create table lancamento_rateio (
  id                  uuid primary key default gen_random_uuid(),
  lancamento_id       uuid not null references lancamentos(id) on delete cascade,
  advogado_id         uuid not null references advogados(id),
  papel               papel_rateio not null default 'responsavel',
  percentual          numeric(6,3) not null check (percentual >= 0 and percentual <= 100),
  percentual_sugerido numeric(6,3),
  origem_percentual   origem_percentual not null default 'padrao_advogado',
  valor               numeric(14,2) not null check (valor >= 0),
  pago                boolean not null default false,
  data_repasse        date,
  observacao          text,
  unique (lancamento_id, advogado_id, papel)
);
create index idx_rateio_advogado on lancamento_rateio (advogado_id);

-- Validação da soma dos percentuais de rateio (especificação §4.9)
create or replace function fn_valida_rateio() returns trigger as $$
declare soma numeric(6,3);
begin
  select coalesce(sum(percentual),0) into soma
    from public.lancamento_rateio where lancamento_id = coalesce(new.lancamento_id, old.lancamento_id);
  if soma > 100.001 then
    raise exception 'A soma dos percentuais do rateio é %. O limite é 100%%.', soma;
  end if;
  return null;
end $$ language plpgsql set search_path = '';

create constraint trigger tg_valida_rateio
  after insert or update or delete on lancamento_rateio
  deferrable initially deferred
  for each row execute function fn_valida_rateio();
