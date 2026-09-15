-- ============================================================
-- rpc_salvar_lancamento — upsert de cabeçalho + rateio (especificação §5.3)
-- ============================================================
-- Ponto crítico: por ser security definer, esta função ignora a RLS de
-- `lancamentos`/`lancamento_rateio`. A checagem de perfil abaixo é o único
-- controle de acesso real da escrita — sem ela, qualquer usuário autenticado
-- conseguiria lançar honorários mesmo com a RLS de escrita da tabela negando
-- acesso direto.
create or replace function rpc_salvar_lancamento(
  p_lancamento jsonb,
  p_rateio     jsonb,
  p_motivo     text default null
) returns uuid as $$
declare
  v_id uuid := (p_lancamento->>'id')::uuid;
  v_status public.status_lancamento;
  v_valor_bruto numeric(14,2) := (p_lancamento->>'valor_bruto')::numeric;
  v_valor_base  numeric(14,2) := coalesce((p_lancamento->>'valor_base')::numeric, (p_lancamento->>'valor_bruto')::numeric);
  v_soma_percentual numeric(6,3);
  v_base_centavos bigint;
  v_alvo_centavos bigint;
  v_sobra_piso bigint;
  v_residuo bigint;
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para lançar ou alterar honorários.' using errcode = '42501';
  end if;

  if v_id is not null and coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo da alteração.' using errcode = 'P0001';
  end if;

  if v_id is not null then
    select status into v_status from public.lancamentos where id = v_id;
    if v_status is null then
      raise exception 'Lançamento não encontrado.';
    end if;
    if v_status = 'estornado' then
      raise exception 'Lançamento estornado não pode ser editado; duplique para lançar de novo.';
    end if;
  end if;

  if (p_lancamento->>'cliente_id') is null then
    raise exception 'Informe o cliente.';
  end if;
  if (p_lancamento->>'tipo_processo_id') is null then
    raise exception 'Informe o tipo de processo.';
  end if;
  if (p_lancamento->>'tipo_servico_id') is null then
    raise exception 'Informe o tipo de serviço.';
  end if;
  if v_valor_bruto is null or v_valor_bruto <= 0 then
    raise exception 'Valor bruto deve ser maior que zero.';
  end if;
  if v_valor_base is null or v_valor_base <= 0 then
    raise exception 'Valor base deve ser maior que zero.';
  end if;
  if v_valor_base > v_valor_bruto then
    raise exception 'Valor base não pode ser maior que o valor bruto.';
  end if;

  select coalesce(sum((x->>'percentual')::numeric), 0) into v_soma_percentual
    from jsonb_array_elements(coalesce(p_rateio, '[]'::jsonb)) as x;
  if v_soma_percentual > 100.001 then
    raise exception 'A soma dos percentuais do rateio é %. O limite é 100%%.', v_soma_percentual;
  end if;

  perform set_config('app.motivo', coalesce(p_motivo,''), true);
  perform set_config('app.tela', 'lancamento', true);

  if v_id is null then
    insert into public.lancamentos (
      data_competencia, data_pagamento, cliente_id, processo_id,
      tipo_processo_id, tipo_servico_id, descricao, valor_bruto, valor_base,
      forma_pagamento, observacao, criado_por
    ) values (
      coalesce((p_lancamento->>'data_competencia')::date, current_date),
      (p_lancamento->>'data_pagamento')::date,
      (p_lancamento->>'cliente_id')::uuid,
      (p_lancamento->>'processo_id')::uuid,
      (p_lancamento->>'tipo_processo_id')::uuid,
      (p_lancamento->>'tipo_servico_id')::uuid,
      p_lancamento->>'descricao',
      v_valor_bruto, v_valor_base,
      p_lancamento->>'forma_pagamento',
      p_lancamento->>'observacao',
      auth.uid()
    ) returning id into v_id;
  else
    update public.lancamentos set
      data_competencia = coalesce((p_lancamento->>'data_competencia')::date, data_competencia),
      data_pagamento   = (p_lancamento->>'data_pagamento')::date,
      cliente_id       = (p_lancamento->>'cliente_id')::uuid,
      processo_id      = (p_lancamento->>'processo_id')::uuid,
      tipo_processo_id = (p_lancamento->>'tipo_processo_id')::uuid,
      tipo_servico_id  = (p_lancamento->>'tipo_servico_id')::uuid,
      descricao        = p_lancamento->>'descricao',
      valor_bruto      = v_valor_bruto,
      valor_base       = v_valor_base,
      forma_pagamento  = p_lancamento->>'forma_pagamento',
      observacao       = p_lancamento->>'observacao',
      atualizado_em    = now(),
      atualizado_por   = auth.uid()
    where id = v_id;
  end if;

  -- Algoritmo do maior resto (especificação §4.8), em centavos inteiros: piso por
  -- linha + distribuição do resíduo pela maior fração descartada. Evita resíduo
  -- negativo, ao contrário de "arredondar cada linha e depois calcular a sobra".
  create temporary table tmp_rateio (
    advogado_id uuid,
    papel public.papel_rateio,
    percentual numeric(6,3),
    percentual_sugerido numeric(6,3),
    origem_percentual public.origem_percentual,
    piso bigint,
    fracao numeric,
    valor numeric(14,2)
  ) on commit drop;

  insert into tmp_rateio (advogado_id, papel, percentual, percentual_sugerido, origem_percentual)
  select (x->>'advogado_id')::uuid,
         (x->>'papel')::public.papel_rateio,
         (x->>'percentual')::numeric,
         nullif(x->>'percentual_sugerido','')::numeric,
         (x->>'origem_percentual')::public.origem_percentual
  from jsonb_array_elements(coalesce(p_rateio, '[]'::jsonb)) as x;

  v_base_centavos := round(v_valor_base * 100)::bigint;
  v_alvo_centavos := round(v_base_centavos * v_soma_percentual / 100)::bigint;

  update tmp_rateio set
    piso   = floor(v_base_centavos * percentual / 100),
    fracao = (v_base_centavos * percentual / 100) - floor(v_base_centavos * percentual / 100);

  select coalesce(sum(piso), 0) into v_sobra_piso from tmp_rateio;
  v_residuo := v_alvo_centavos - v_sobra_piso;

  with ranking as (
    select advogado_id, papel,
           row_number() over (order by fracao desc, advogado_id) as posicao
    from tmp_rateio
  )
  update tmp_rateio t set valor = (
    (t.piso + case when r.posicao <= v_residuo then 1 else 0 end) / 100.0
  )
  from ranking r
  where r.advogado_id = t.advogado_id and r.papel = t.papel;

  begin
    delete from public.lancamento_rateio where lancamento_id = v_id;

    insert into public.lancamento_rateio (
      lancamento_id, advogado_id, papel, percentual, percentual_sugerido, origem_percentual, valor
    )
    select v_id, advogado_id, papel, percentual, percentual_sugerido, origem_percentual, valor
    from tmp_rateio;
  exception
    when unique_violation then
      raise exception 'Advogado já aparece com este papel no rateio.';
    when check_violation then
      raise exception 'Percentual ou valor fora do intervalo permitido.';
  end;

  return v_id;
end;
$$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_estornar_lancamento (especificação §5.3, corpo dado literalmente)
-- ============================================================
create or replace function rpc_estornar_lancamento(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para estornar lançamentos.' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'lancamento', true);
  update public.lancamentos
     set status = 'estornado', estornado_em = now(),
         estornado_por = auth.uid(), motivo_estorno = p_motivo
   where id = p_id and status <> 'estornado';
end $$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_excluir_rascunho — exclusão física, só para rascunhos nunca confirmados
-- (especificação §5.3: "exclusão física só existe para rascunhos"; sem
-- chamador nesta fase, já que o rascunho hoje só existe em sessionStorage
-- no design da tela de lançamento — fica pronta para quando isso mudar).
-- ============================================================
create or replace function rpc_excluir_rascunho(p_id uuid)
returns void as $$
begin
  delete from public.lancamentos
   where id = p_id
     and status = 'rascunho'
     and (private.perfil_atual() in ('admin','financeiro') or criado_por = auth.uid());
end $$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_painel — indicadores e séries do painel em uma única chamada (§8.1-8.4)
-- ============================================================
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
                   and l2.status <> 'estornado'), 0) as honorarios_ano_anterior
    from meses m
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
        'quantidade', (select count(*) from public.lancamentos where status = 'estornado' and data_competencia between v_de and v_ate),
        'valor', (select coalesce(sum(valor_bruto),0) from public.lancamentos where status = 'estornado' and data_competencia between v_de and v_ate)
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
      )
    ),

    'filtros_aplicados', p_filtros
  ) into v_resultado;

  return v_resultado;
end;
$$ language plpgsql stable security definer set search_path = '';

-- ============================================================
-- Grants — remove execução pública, libera só para authenticated
-- ============================================================
revoke execute on function rpc_salvar_lancamento(jsonb,jsonb,text) from public, anon;
revoke execute on function rpc_estornar_lancamento(uuid,text)      from public, anon;
revoke execute on function rpc_excluir_rascunho(uuid)               from public, anon;
revoke execute on function rpc_painel(jsonb)                        from public, anon;
grant  execute on function rpc_salvar_lancamento(jsonb,jsonb,text) to authenticated;
grant  execute on function rpc_estornar_lancamento(uuid,text)      to authenticated;
grant  execute on function rpc_excluir_rascunho(uuid)               to authenticated;
grant  execute on function rpc_painel(jsonb)                        to authenticated;
