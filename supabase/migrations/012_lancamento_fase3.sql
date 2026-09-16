-- Fase 3 — tela de lançamento (especificação §7.5).
-- Duas lacunas pequenas: a tela de lançamento passa a usar o `store.js` para
-- cache reativo de clientes (mesmo padrão de advogados/tipos), e precisa de
-- uma sugestão de tipo de processo/serviço mais usados pelo cliente nos
-- últimos 12 meses (§7.5: "preenche o tipo de processo e o tipo de serviço
-- mais usados por ele nos últimos 12 meses"). O resto do backend (tabelas,
-- rpc_salvar_lancamento, auditoria, RLS) já foi construído na Fase 1.

alter publication supabase_realtime add table public.clientes;

create or replace function rpc_sugestao_cliente(p_cliente_id uuid)
returns jsonb as $$
declare
  v_resultado jsonb;
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para lançar honorários.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tipo_processo_id', tipo_processo_id,
    'tipo_servico_id', tipo_servico_id
  ) into v_resultado
  from public.lancamentos
  where cliente_id = p_cliente_id
    and status <> 'estornado'
    and data_competencia >= (current_date - interval '12 months')
  group by tipo_processo_id, tipo_servico_id
  order by count(*) desc, max(criado_em) desc
  limit 1;

  return v_resultado;
end;
$$ language plpgsql stable security definer set search_path = '';

revoke execute on function rpc_sugestao_cliente(uuid) from public, anon;
grant  execute on function rpc_sugestao_cliente(uuid) to authenticated;
