-- ============================================================
-- rpc_ativar_advogado / rpc_ativar_cliente — reativação, simétrica à
-- inativação (especificação §7.6 não cobre reativação explicitamente,
-- mas mantemos o mesmo padrão de motivo obrigatório para preservar a
-- trilha de auditoria de por que o status mudou nos dois sentidos).
-- ============================================================
create or replace function rpc_ativar_advogado(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para ativar advogados.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo,''))) < 10 then
    raise exception 'Informe o motivo da reativação (mínimo 10 caracteres).';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'advogados', true);
  update public.advogados set ativo = true where id = p_id and ativo = false;
end $$ language plpgsql security definer set search_path = '';

create or replace function rpc_ativar_cliente(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro') then
    raise exception 'Sem permissão para ativar clientes.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo,''))) < 10 then
    raise exception 'Informe o motivo da reativação (mínimo 10 caracteres).';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'clientes', true);
  update public.clientes set ativo = true where id = p_id and ativo = false;
end $$ language plpgsql security definer set search_path = '';

revoke execute on function rpc_ativar_advogado(uuid,text) from public, anon;
revoke execute on function rpc_ativar_cliente(uuid,text) from public, anon;
grant  execute on function rpc_ativar_advogado(uuid,text) to authenticated;
grant  execute on function rpc_ativar_cliente(uuid,text) to authenticated;
