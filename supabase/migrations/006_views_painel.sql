-- Materialized view de meses fechados para o painel (especificação §8.4)
-- O mês corrente é sempre calculado ao vivo por rpc_painel e unido a esta view;
-- aqui só entram meses já encerrados, para que o refresh periódico não precise
-- disputar com lançamentos em andamento no mês atual.
create materialized view mv_honorarios_mensal as
with base as (
  select l.id, date_trunc('month', l.data_competencia)::date as mes,
         l.valor_bruto, l.valor_base
  from lancamentos l
  where l.status <> 'estornado'
    and l.data_competencia < date_trunc('month', current_date)
),
repasse as (
  select b.mes, sum(r.valor) as repasse
  from base b join lancamento_rateio r on r.lancamento_id = b.id
  group by b.mes
)
select b.mes,
       count(distinct b.id)      as qtd_lancamentos,
       sum(b.valor_bruto)        as honorarios,
       sum(b.valor_base)         as base_rateio,
       coalesce(rp.repasse, 0)   as repasse,
       sum(b.valor_base) - coalesce(rp.repasse, 0) as retencao
from base b
left join repasse rp on rp.mes = b.mes
group by b.mes, rp.repasse;

-- Índice único obrigatório para permitir refresh sem bloquear leitura
create unique index idx_mv_honorarios_mensal_mes on mv_honorarios_mensal (mes);

-- Não expor a materialized view pela Data API (Postgres não aplica RLS a
-- matviews da mesma forma que a tabelas; o acesso é só via rpc_painel,
-- que roda como security definer).
revoke all on mv_honorarios_mensal from anon, authenticated;

-- Refresh periódico via pg_cron (disponível por padrão no Postgres do Supabase CLI/hospedado)
create extension if not exists pg_cron;

select cron.schedule(
  'refresh_mv_honorarios_mensal',
  '*/15 * * * *',
  $$refresh materialized view concurrently mv_honorarios_mensal$$
);
