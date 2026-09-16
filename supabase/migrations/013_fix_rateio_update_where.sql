-- Fix: `rpc_salvar_lancamento` falhava em toda gravação com "UPDATE requires
-- a WHERE clause" — o Supabase roda com a extensão safeupdate, que bloqueia
-- qualquer UPDATE/DELETE sem WHERE (proteção contra update em massa por
-- engano). O passo do algoritmo de maior resto (§4.8) que calcula piso/fração
-- por linha atualiza a tabela temporária inteira de propósito (todas as
-- linhas do rateio do lançamento), então o WHERE precisa existir mas não
-- filtrar nada: `where true`.
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
    fracao = (v_base_centavos * percentual / 100) - floor(v_base_centavos * percentual / 100)
  where true; -- atualiza todas as linhas de propósito; safeupdate exige um WHERE explícito

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
