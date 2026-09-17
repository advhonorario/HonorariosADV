-- Fix: `divisao_faixa_valor` (migration 015) falhava com "aggregate function
-- calls cannot contain window function calls" — o Postgres não deixa usar
-- `sum(...) over (...)` (window function) direto dentro do argumento de
-- `jsonb_agg(...)` (aggregate function) na mesma consulta. Precisa materializar
-- a window function numa subconsulta antes de agregar.
create or replace function rpc_painel(p_filtros jsonb default '{}'::jsonb)
returns jsonb as $$
declare
  v_de date := coalesce((p_filtros->>'de')::date, date_trunc('year', current_date)::date);
  v_ate date := coalesce((p_filtros->>'ate')::date, current_date);
  v_advogados uuid[] := (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'advogados','[]'::jsonb)) value);
  v_clientes uuid[] := (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'clientes','[]'::jsonb)) value);
  v_tipos_processo uuid[] := (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'tipos_processo','[]'::jsonb)) value);
  v_tipos_servico uuid[] := (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'tipos_servico','[]'::jsonb)) value);
  v_papeis public.papel_rateio[] := (select array_agg(value::public.papel_rateio) from jsonb_array_elements_text(coalesce(p_filtros->'papeis','[]'::jsonb)) value);
  v_status public.status_lancamento[] := (select array_agg(value::public.status_lancamento) from jsonb_array_elements_text(coalesce(p_filtros->'status','[]'::jsonb)) value);
  v_formas text[] := (select array_agg(value) from jsonb_array_elements_text(coalesce(p_filtros->'formas_pagamento','[]'::jsonb)) value);
  v_valor_min numeric := (p_filtros->>'valor_min')::numeric;
  v_valor_max numeric := (p_filtros->>'valor_max')::numeric;
  v_incluir_estornados boolean := coalesce((p_filtros->>'incluir_estornados')::boolean, false);
  v_somente_manual boolean := coalesce((p_filtros->>'somente_manual')::boolean, false);
  v_dias integer := greatest((v_ate - v_de), 1);
  v_de_anterior date := v_de - v_dias - 1;
  v_ate_anterior date := v_de - 1;
  v_eh_advogado boolean := coalesce(private.perfil_atual()::text, '') = 'advogado';
  v_advogado_escopo uuid := private.advogado_atual();
  v_top_advogados uuid[] := case when coalesce(private.perfil_atual()::text, '') = 'advogado' then null else (
    select array_agg(advogado_id) from (
      select r.advogado_id, sum(r.valor) as total
      from public.lancamento_rateio r
      join public.lancamentos l on l.id = r.lancamento_id
      where l.status <> 'estornado'
      group by r.advogado_id
      order by total desc
      limit 5
    ) top5
  ) end;
  v_filtro_simples boolean := (
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'advogados','[]'::jsonb)) value) is null
    and (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'clientes','[]'::jsonb)) value) is null
    and (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'tipos_processo','[]'::jsonb)) value) is null
    and (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_filtros->'tipos_servico','[]'::jsonb)) value) is null
    and (select array_agg(value) from jsonb_array_elements_text(coalesce(p_filtros->'papeis','[]'::jsonb)) value) is null
    and (select array_agg(value) from jsonb_array_elements_text(coalesce(p_filtros->'status','[]'::jsonb)) value) is null
    and (select array_agg(value) from jsonb_array_elements_text(coalesce(p_filtros->'formas_pagamento','[]'::jsonb)) value) is null
    and (p_filtros->>'valor_min') is null and (p_filtros->>'valor_max') is null
    and coalesce((p_filtros->>'somente_manual')::boolean, false) = false
    and not v_eh_advogado
  );
  v_resultado jsonb;
begin
  if private.perfil_atual() is null then
    raise exception 'Usuário não autorizado.' using errcode = '42501';
  end if;

  with lanc_filtrados as (
    select l.*
    from public.lancamentos l
    where l.data_competencia between v_de and v_ate
      and (v_incluir_estornados or l.status <> 'estornado')
      and (v_clientes is null or l.cliente_id = any(v_clientes))
      and (v_tipos_processo is null or l.tipo_processo_id = any(v_tipos_processo))
      and (v_tipos_servico is null or l.tipo_servico_id = any(v_tipos_servico))
      and (v_status is null or l.status = any(v_status))
      and (v_formas is null or l.forma_pagamento = any(v_formas))
      and (v_valor_min is null or l.valor_bruto >= v_valor_min)
      and (v_valor_max is null or l.valor_bruto <= v_valor_max)
      and (v_advogados is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = any(v_advogados)))
      and (v_papeis is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.papel = any(v_papeis)))
      and (not v_somente_manual or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.origem_percentual = 'manual'))
      and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = v_advogado_escopo)))
  ),
  rateio_filtrado as (
    select r.*
    from public.lancamento_rateio r
    join lanc_filtrados l on l.id = r.lancamento_id
    where (v_advogados is null or r.advogado_id = any(v_advogados))
      and (v_papeis is null or r.papel = any(v_papeis))
  ),
  lanc_periodo_anterior as (
    select l.*
    from public.lancamentos l
    where l.data_competencia between v_de_anterior and v_ate_anterior
      and (v_incluir_estornados or l.status <> 'estornado')
      and (v_clientes is null or l.cliente_id = any(v_clientes))
      and (v_tipos_processo is null or l.tipo_processo_id = any(v_tipos_processo))
      and (v_tipos_servico is null or l.tipo_servico_id = any(v_tipos_servico))
      and (v_status is null or l.status = any(v_status))
      and (v_formas is null or l.forma_pagamento = any(v_formas))
      and (v_valor_min is null or l.valor_bruto >= v_valor_min)
      and (v_valor_max is null or l.valor_bruto <= v_valor_max)
      and (v_advogados is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = any(v_advogados)))
      and (v_papeis is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.papel = any(v_papeis)))
      and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = v_advogado_escopo)))
  ),
  rateio_periodo_anterior as (
    select r.*
    from public.lancamento_rateio r
    join lanc_periodo_anterior l on l.id = r.lancamento_id
    where (v_advogados is null or r.advogado_id = any(v_advogados))
      and (v_papeis is null or r.papel = any(v_papeis))
  ),
  meses as (
    select generate_series(
      date_trunc('month', v_ate) - interval '12 months',
      date_trunc('month', v_ate),
      interval '1 month'
    )::date as mes
  ),
  lanc_13meses as (
    select l.*
    from public.lancamentos l
    where l.data_competencia >= (date_trunc('month', v_ate) - interval '12 months')
      and l.data_competencia < (date_trunc('month', v_ate) + interval '1 month')
      and (v_incluir_estornados or l.status <> 'estornado')
      and (v_clientes is null or l.cliente_id = any(v_clientes))
      and (v_tipos_processo is null or l.tipo_processo_id = any(v_tipos_processo))
      and (v_tipos_servico is null or l.tipo_servico_id = any(v_tipos_servico))
      and (v_status is null or l.status = any(v_status))
      and (v_formas is null or l.forma_pagamento = any(v_formas))
      and (v_valor_min is null or l.valor_bruto >= v_valor_min)
      and (v_valor_max is null or l.valor_bruto <= v_valor_max)
      and (v_advogados is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = any(v_advogados)))
      and (v_papeis is null or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.papel = any(v_papeis)))
      and (not v_somente_manual or exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.origem_percentual = 'manual'))
      and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
            select 1 from public.lancamento_rateio r
             where r.lancamento_id = l.id and r.advogado_id = v_advogado_escopo)))
  ),
  evolucao as (
    select
      m.mes,
      case when v_filtro_simples and m.mes < date_trunc('month', current_date)
        then coalesce((select mv.honorarios from public.mv_honorarios_mensal mv where mv.mes = m.mes), 0)
        else coalesce((select sum(l.valor_bruto) from lanc_13meses l where date_trunc('month', l.data_competencia) = m.mes), 0)
      end as honorarios,
      case when v_filtro_simples and m.mes < date_trunc('month', current_date)
        then coalesce((select mv.retencao from public.mv_honorarios_mensal mv where mv.mes = m.mes), 0)
        else coalesce((select sum(l.valor_base) from lanc_13meses l where date_trunc('month', l.data_competencia) = m.mes), 0)
             - coalesce((select sum(r.valor) from public.lancamento_rateio r
                          join lanc_13meses l on l.id = r.lancamento_id
                         where date_trunc('month', l.data_competencia) = m.mes), 0)
      end as retencao,
      coalesce((select sum(l2.valor_bruto) from public.lancamentos l2
                 where date_trunc('month', l2.data_competencia) = (m.mes - interval '1 year')::date
                   and l2.status <> 'estornado'
                   and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
                         select 1 from public.lancamento_rateio r2
                          where r2.lancamento_id = l2.id and r2.advogado_id = v_advogado_escopo)))
                ), 0) as honorarios_ano_anterior
    from meses m
  ),
  anos_escritorio as (
    select extract(year from l.data_competencia)::int as ano, sum(l.valor_bruto) as escritorio
    from public.lancamentos l
    where l.status <> 'estornado'
      and (v_clientes is null or l.cliente_id = any(v_clientes))
      and (v_tipos_processo is null or l.tipo_processo_id = any(v_tipos_processo))
      and (v_tipos_servico is null or l.tipo_servico_id = any(v_tipos_servico))
      and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
            select 1 from public.lancamento_rateio r4 where r4.lancamento_id = l.id and r4.advogado_id = v_advogado_escopo)))
    group by 1
  ),
  anos_advogados as (
    select extract(year from l.data_competencia)::int as ano, r.advogado_id, sum(r.valor) as valor
    from public.lancamento_rateio r
    join public.lancamentos l on l.id = r.lancamento_id
    where l.status <> 'estornado'
      and (v_clientes is null or l.cliente_id = any(v_clientes))
      and (v_tipos_processo is null or l.tipo_processo_id = any(v_tipos_processo))
      and (v_tipos_servico is null or l.tipo_servico_id = any(v_tipos_servico))
      and (not v_eh_advogado or r.advogado_id = v_advogado_escopo)
      and (v_eh_advogado or v_top_advogados is null or r.advogado_id = any(v_top_advogados))
    group by 1, 2
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),

    'indicadores', jsonb_build_object(
      'honorarios_periodo', jsonb_build_object(
        'valor', (select coalesce(sum(valor_bruto),0) from lanc_filtrados),
        'variacao_pct', (
          select case when coalesce(sum(a.valor_bruto),0) = 0 then null
            else round((((select coalesce(sum(valor_bruto),0) from lanc_filtrados) - sum(a.valor_bruto)) / sum(a.valor_bruto)) * 100, 1)
          end from lanc_periodo_anterior a)
      ),
      'base_rateio', jsonb_build_object(
        'valor', (select coalesce(sum(valor_base),0) from lanc_filtrados),
        'variacao_pct', (
          select case when coalesce(sum(a.valor_base),0) = 0 then null
            else round((((select coalesce(sum(valor_base),0) from lanc_filtrados) - sum(a.valor_base)) / sum(a.valor_base)) * 100, 1)
          end from lanc_periodo_anterior a)
      ),
      'repasse_advogados', jsonb_build_object(
        'valor', (select coalesce(sum(valor),0) from rateio_filtrado),
        'variacao_pct', (
          select case when coalesce(sum(a.valor),0) = 0 then null
            else round((((select coalesce(sum(valor),0) from rateio_filtrado) - sum(a.valor)) / sum(a.valor)) * 100, 1)
          end from rateio_periodo_anterior a)
      ),
      'retencao_escritorio', jsonb_build_object(
        'valor', (select coalesce(sum(valor_base),0) from lanc_filtrados) - (select coalesce(sum(valor),0) from rateio_filtrado),
        'percentual', (
          select case when coalesce(sum(valor_base),0) = 0 then null
            else round((((select coalesce(sum(valor_base),0) from lanc_filtrados) - (select coalesce(sum(valor),0) from rateio_filtrado)) / sum(valor_base)) * 100, 1)
          end from lanc_filtrados)
      ),
      'ticket_medio', jsonb_build_object(
        'valor', (select case when count(*) = 0 then 0 else round(sum(valor_bruto) / count(*), 2) end from lanc_filtrados)
      ),
      'receita_indicacao', jsonb_build_object(
        'valor', (select coalesce(sum(valor),0) from rateio_filtrado where papel = 'indicacao'),
        'percentual_do_total', (
          select case when coalesce(sum(valor_base),0) = 0 then null
            else round(((select coalesce(sum(valor),0) from rateio_filtrado where papel = 'indicacao') / sum(valor_base)) * 100, 1)
          end from lanc_filtrados)
      ),
      'fora_padrao_pct', jsonb_build_object(
        'valor', (select case when count(*) = 0 then 0
                    else round((count(*) filter (where origem_percentual = 'manual')::numeric / count(*)) * 100, 1)
                  end from rateio_filtrado)
      ),
      'prazo_medio_recebimento_dias', jsonb_build_object(
        'valor', (select round(avg(data_pagamento - data_competencia), 1)
                    from lanc_filtrados where data_pagamento is not null)
      )
    ),

    'indicadores_secundarios', jsonb_build_object(
      'estornos', jsonb_build_object(
        'quantidade', (select count(*) from public.lancamentos l3
                         where l3.status = 'estornado' and l3.data_competencia between v_de and v_ate
                           and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
                                 select 1 from public.lancamento_rateio r3
                                  where r3.lancamento_id = l3.id and r3.advogado_id = v_advogado_escopo)))),
        'valor', (select coalesce(sum(l3.valor_bruto),0) from public.lancamentos l3
                    where l3.status = 'estornado' and l3.data_competencia between v_de and v_ate
                      and (not v_eh_advogado or (v_advogado_escopo is not null and exists (
                            select 1 from public.lancamento_rateio r3
                             where r3.lancamento_id = l3.id and r3.advogado_id = v_advogado_escopo))))
      ),
      'lancamentos_sem_processo', jsonb_build_object(
        'quantidade', (select count(*) from lanc_filtrados where processo_id is null)
      ),
      'clientes_novos', jsonb_build_object(
        'quantidade', (select count(*) from public.clientes where data_cadastro between v_de and v_ate)
      )
    ),

    'series', jsonb_build_object(
      'evolucao_mensal', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'mes', e.mes, 'honorarios', e.honorarios, 'retencao', e.retencao,
          'honorarios_ano_anterior', e.honorarios_ano_anterior
        ) order by e.mes), '[]'::jsonb)
        from evolucao e
      ),
      'mapa_calor_tipo_servico', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tipo_processo', tp.nome, 'tipo_servico', ts.nome, 'valor', agg.valor
        )), '[]'::jsonb)
        from (
          select tipo_processo_id, tipo_servico_id, sum(valor_bruto) as valor
          from lanc_filtrados group by tipo_processo_id, tipo_servico_id
        ) agg
        join public.tipos_processo tp on tp.id = agg.tipo_processo_id
        join public.tipos_servico ts on ts.id = agg.tipo_servico_id
      ),
      'ranking_advogados', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'advogado_id', a.id, 'nome', a.nome, 'repasse', agg.repasse, 'percentual_medio', agg.percentual_medio
        ) order by agg.repasse desc), '[]'::jsonb)
        from (
          select advogado_id, sum(valor) as repasse, round(avg(percentual), 1) as percentual_medio
          from rateio_filtrado group by advogado_id
        ) agg
        join public.advogados a on a.id = agg.advogado_id
      ),
      'concentracao_clientes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'cliente_id', x.cliente_id, 'nome', x.nome, 'valor', x.valor,
          'percentual_acumulado', x.percentual_acumulado
        ) order by x.valor desc), '[]'::jsonb)
        from (
          select c.id as cliente_id, c.nome, agg.valor,
                 round((sum(agg.valor) over (order by agg.valor desc rows unbounded preceding)
                        / nullif(sum(agg.valor) over (), 0)) * 100, 1) as percentual_acumulado
          from (
            select cliente_id, sum(valor_bruto) as valor from lanc_filtrados group by cliente_id
            order by valor desc limit 10
          ) agg
          join public.clientes c on c.id = agg.cliente_id
        ) x
      ),
      'indicacao_vs_propria', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'mes', x.mes, 'indicacao', x.indicacao, 'propria', x.propria
        ) order by x.mes), '[]'::jsonb)
        from (
          select date_trunc('month', l.data_competencia)::date as mes,
                 sum(r.valor) filter (where r.papel = 'indicacao') as indicacao,
                 sum(r.valor) filter (where r.papel <> 'indicacao') as propria
          from lanc_filtrados l
          join public.lancamento_rateio r on r.lancamento_id = l.id
          group by 1
        ) x
      ),
      'composicao_tipo_processo', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tipo_processo', tp.nome, 'valor', agg.valor
        ) order by agg.valor desc), '[]'::jsonb)
        from (
          select tipo_processo_id, sum(valor_bruto) as valor
          from lanc_filtrados group by tipo_processo_id
        ) agg
        join public.tipos_processo tp on tp.id = agg.tipo_processo_id
      ),

      'processos_por_ano', (
        select coalesce(jsonb_agg(jsonb_build_object('ano', x.rotulo, 'quantidade', x.quantidade) order by x.ordem), '[]'::jsonb)
        from (
          select
            case when p.data_distribuicao is null or extract(year from p.data_distribuicao) < 2020
                   then 'Anterior a 2020'
                 else extract(year from p.data_distribuicao)::text end as rotulo,
            case when p.data_distribuicao is null or extract(year from p.data_distribuicao) < 2020
                   then 0 else extract(year from p.data_distribuicao)::int end as ordem,
            count(*) as quantidade
          from public.processos p
          where (v_clientes is null or p.cliente_id = any(v_clientes))
            and (v_tipos_processo is null or p.tipo_processo_id = any(v_tipos_processo))
          group by 1, 2
        ) x
      ),

      'variacao_anual', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'ano', e.ano, 'escritorio', e.escritorio,
          'advogados', (
            select coalesce(jsonb_object_agg(a.nome, aa.valor), '{}'::jsonb)
            from anos_advogados aa join public.advogados a on a.id = aa.advogado_id
            where aa.ano = e.ano
          )
        ) order by e.ano), '[]'::jsonb)
        from anos_escritorio e
      ),

      'maiores_honorarios_advogado', (
        case when array_length(v_advogados, 1) = 1 then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'cliente', x.cliente, 'descricao', x.descricao, 'valor', x.valor
          ) order by x.valor desc), '[]'::jsonb)
          from (
            select c.nome as cliente,
                   coalesce(nullif(l.descricao, ''), tp.nome) as descricao,
                   r.valor
            from public.lancamento_rateio r
            join lanc_filtrados l on l.id = r.lancamento_id
            join public.clientes c on c.id = l.cliente_id
            join public.tipos_processo tp on tp.id = l.tipo_processo_id
            where r.advogado_id = v_advogados[1]
            order by r.valor desc
            limit 10
          ) x
        ) else '[]'::jsonb end
      ),

      'divisao_por_indicador', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'advogado_id', a.id, 'nome', a.nome, 'valor', agg.valor
        ) order by agg.valor desc), '[]'::jsonb)
        from (
          select advogado_id, sum(valor) as valor
          from rateio_filtrado where papel = 'indicacao' group by advogado_id
        ) agg
        join public.advogados a on a.id = agg.advogado_id
      ),

      'divisao_faixa_valor', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'faixa', y.faixa, 'valor', y.valor, 'quantidade', y.quantidade, 'percentual', y.percentual
        ) order by y.ordem), '[]'::jsonb)
        from (
          select x.*, round((x.valor / nullif(sum(x.valor) over (), 0)) * 100, 1) as percentual
          from (
            select
              case when valor_bruto >= 5000 then 'Acima de R$ 5.000'
                   when valor_bruto >= 2000 then 'De R$ 2.000 a R$ 5.000'
                   else 'Abaixo de R$ 2.000' end as faixa,
              case when valor_bruto >= 5000 then 1 when valor_bruto >= 2000 then 2 else 3 end as ordem,
              sum(valor_bruto) as valor, count(*) as quantidade
            from lanc_filtrados
            group by 1, 2
          ) x
        ) y
      )
    ),

    'filtros_aplicados', p_filtros
  ) into v_resultado;

  return v_resultado;
end;
$$ language plpgsql stable security definer set search_path = '';
