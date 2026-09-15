-- Log de auditoria (especificação §5.1)
create table logs_auditoria (
  id           bigint generated always as identity primary key,
  ocorrido_em  timestamptz not null default now(),
  usuario_id   uuid references usuarios(id),
  usuario_nome text,
  perfil       perfil_usuario,
  tela         text,
  entidade     text not null,
  registro_id  uuid,
  registro_ref text,
  acao         acao_auditoria not null,
  motivo       text,
  dados_antes  jsonb,
  dados_depois jsonb,
  campos       text[],
  ip           inet,
  user_agent   text
);
create index idx_log_periodo  on logs_auditoria (ocorrido_em desc);
create index idx_log_entidade on logs_auditoria (entidade, registro_id, ocorrido_em desc);
create index idx_log_usuario  on logs_auditoria (usuario_id, ocorrido_em desc);
create index idx_log_dados    on logs_auditoria using gin (dados_depois jsonb_path_ops);

-- Trigger genérica de auditoria (especificação §5.2)
create or replace function fn_auditoria() returns trigger as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_campos text[];
  v_usuario uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    select array_agg(key) into v_campos
      from jsonb_each(v_depois) d
     where d.value is distinct from v_antes -> d.key
       and d.key not in ('atualizado_em','atualizado_por');
    if v_campos is null then return coalesce(new, old); end if;
  end if;

  insert into public.logs_auditoria (
    usuario_id, usuario_nome, perfil, tela, entidade, registro_id,
    acao, motivo, dados_antes, dados_depois, campos
  )
  select v_usuario, u.nome, u.perfil,
         nullif(current_setting('app.tela', true), ''),
         tg_table_name,
         coalesce((v_depois->>'id')::uuid, (v_antes->>'id')::uuid),
         tg_op::public.acao_auditoria,
         nullif(current_setting('app.motivo', true), ''),
         v_antes, v_depois, v_campos
    from public.usuarios u where u.id = v_usuario;

  return coalesce(new, old);
end $$ language plpgsql security definer set search_path = '';

-- Aplicar em todas as tabelas de negócio (especificação §5.2)
create trigger tg_audit_advogados
  after insert or update or delete on advogados
  for each row execute function fn_auditoria();
create trigger tg_audit_usuarios
  after insert or update or delete on usuarios
  for each row execute function fn_auditoria();
create trigger tg_audit_clientes
  after insert or update or delete on clientes
  for each row execute function fn_auditoria();
create trigger tg_audit_tipos_processo
  after insert or update or delete on tipos_processo
  for each row execute function fn_auditoria();
create trigger tg_audit_tipos_servico
  after insert or update or delete on tipos_servico
  for each row execute function fn_auditoria();
create trigger tg_audit_advogado_percentual
  after insert or update or delete on advogado_percentual
  for each row execute function fn_auditoria();
create trigger tg_audit_processos
  after insert or update or delete on processos
  for each row execute function fn_auditoria();
create trigger tg_audit_lancamentos
  after insert or update or delete on lancamentos
  for each row execute function fn_auditoria();
create trigger tg_audit_lancamento_rateio
  after insert or update or delete on lancamento_rateio
  for each row execute function fn_auditoria();

-- `atualizado_em`/`atualizado_por` para escritas diretas em cadastros que ainda não têm RPC própria
-- (advogados e clientes, únicas tabelas de cadastro com essas colunas — ver CLAUDE.md sobre o
-- limite Fase 1 / Fase 2: outras telas de cadastro ganham RPC dedicada na Fase 2).
create or replace function fn_marcar_atualizacao() returns trigger as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$ language plpgsql set search_path = '';

create trigger tg_atualizacao_advogados
  before update on advogados
  for each row execute function fn_marcar_atualizacao();
create trigger tg_atualizacao_clientes
  before update on clientes
  for each row execute function fn_marcar_atualizacao();
