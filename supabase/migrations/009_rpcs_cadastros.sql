-- ============================================================
-- rpc_inativar_advogado — inativação exige motivo (especificação §7.2/§7.6)
-- ============================================================
create or replace function rpc_inativar_advogado(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para inativar advogados.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo,''))) < 10 then
    raise exception 'Informe o motivo da inativação (mínimo 10 caracteres).';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'advogados', true);
  update public.advogados set ativo = false where id = p_id and ativo = true;
end $$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_inativar_cliente — inativação exige motivo (especificação §7.4/§7.6)
-- ============================================================
create or replace function rpc_inativar_cliente(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para inativar clientes.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo,''))) < 10 then
    raise exception 'Informe o motivo da inativação (mínimo 10 caracteres).';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'clientes', true);
  update public.clientes set ativo = false where id = p_id and ativo = true;
end $$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_atualizar_percentual_padrao — alteração de percentual padrão exige
-- motivo (especificação §7.6); isolada numa RPC própria para não forçar
-- motivo em edições de OAB/contato/PIX, que continuam via update direto.
-- ============================================================
create or replace function rpc_atualizar_percentual_padrao(
  p_advogado_id uuid, p_percentual numeric, p_motivo text
) returns void as $$
declare
  v_atual numeric;
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para alterar percentual padrão.' using errcode = '42501';
  end if;
  if p_percentual is null or p_percentual < 0 or p_percentual > 100 then
    raise exception 'Percentual deve estar entre 0 e 100.';
  end if;

  select percentual_padrao into v_atual from public.advogados where id = p_advogado_id;
  if not found then
    raise exception 'Advogado não encontrado.';
  end if;

  if v_atual is distinct from p_percentual then
    if length(trim(coalesce(p_motivo,''))) < 10 then
      raise exception 'Informe o motivo da alteração (mínimo 10 caracteres).';
    end if;
    perform set_config('app.motivo', p_motivo, true);
  end if;
  perform set_config('app.tela', 'advogados', true);

  update public.advogados set percentual_padrao = p_percentual where id = p_advogado_id;
end $$ language plpgsql security definer set search_path = '';

-- ============================================================
-- rpc_atualizar_indicacao_cliente — motivo obrigatório só quando remove ou
-- troca um indicador já existente (especificação §7.4/§7.6). Primeiro
-- cadastro de indicador e ajuste de percentual do mesmo indicador não
-- exigem motivo. p_advogado_indicacao_id = null limpa a indicação.
-- ============================================================
create or replace function rpc_atualizar_indicacao_cliente(
  p_cliente_id uuid,
  p_advogado_indicacao_id uuid,
  p_percentual_indicacao numeric,
  p_motivo text
) returns void as $$
declare
  v_indicador_atual uuid;
  v_exige_motivo boolean;
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para alterar indicação do cliente.' using errcode = '42501';
  end if;
  if p_percentual_indicacao is not null and (p_percentual_indicacao < 0 or p_percentual_indicacao > 100) then
    raise exception 'Percentual de indicação deve estar entre 0 e 100.';
  end if;

  select advogado_indicacao_id into v_indicador_atual
    from public.clientes where id = p_cliente_id;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  v_exige_motivo := v_indicador_atual is not null
    and v_indicador_atual is distinct from p_advogado_indicacao_id;

  if v_exige_motivo then
    if length(trim(coalesce(p_motivo,''))) < 10 then
      raise exception 'Informe o motivo da remoção da indicação (mínimo 10 caracteres).';
    end if;
    perform set_config('app.motivo', p_motivo, true);
  end if;
  perform set_config('app.tela', 'clientes', true);

  update public.clientes
     set advogado_indicacao_id = p_advogado_indicacao_id,
         percentual_indicacao  = coalesce(p_percentual_indicacao, 0)
   where id = p_cliente_id;
end $$ language plpgsql security definer set search_path = '';

revoke execute on function rpc_inativar_advogado(uuid,text) from public, anon;
revoke execute on function rpc_inativar_cliente(uuid,text) from public, anon;
revoke execute on function rpc_atualizar_percentual_padrao(uuid,numeric,text) from public, anon;
revoke execute on function rpc_atualizar_indicacao_cliente(uuid,uuid,numeric,text) from public, anon;
grant  execute on function rpc_inativar_advogado(uuid,text) to authenticated;
grant  execute on function rpc_inativar_cliente(uuid,text) to authenticated;
grant  execute on function rpc_atualizar_percentual_padrao(uuid,numeric,text) to authenticated;
grant  execute on function rpc_atualizar_indicacao_cliente(uuid,uuid,numeric,text) to authenticated;
