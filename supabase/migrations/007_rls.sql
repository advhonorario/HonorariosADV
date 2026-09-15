-- ============================================================
-- Funções auxiliares (schema `private`, não exposto pela Data API)
-- ============================================================

create or replace function private.perfil_atual() returns perfil_usuario
language sql stable security definer set search_path = '' as $$
  select perfil from public.usuarios where id = (select auth.uid());
$$;

create or replace function private.advogado_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select advogado_id from public.usuarios where id = (select auth.uid());
$$;

create or replace function private.eh_admin_financeiro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.perfil in ('admin','financeiro')
  );
$$;

revoke execute on function private.perfil_atual()        from public, anon;
revoke execute on function private.advogado_atual()       from public, anon;
revoke execute on function private.eh_admin_financeiro()  from public, anon;
grant  execute on function private.perfil_atual()         to authenticated;
grant  execute on function private.advogado_atual()       to authenticated;
grant  execute on function private.eh_admin_financeiro()  to authenticated;

-- ============================================================
-- Mascaramento LGPD (especificação §11) — RLS controla linhas,
-- estas views controlam colunas sensíveis dentro das linhas visíveis.
-- ============================================================

create or replace function private.mascarar_documento(p_doc text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_doc is null then null
    when length(regexp_replace(p_doc, '\D', '', 'g')) <= 5
      then repeat('•', length(p_doc))
    else left(p_doc, 3) || repeat('•', greatest(length(p_doc) - 5, 1)) || right(p_doc, 2)
  end;
$$;

create view vw_advogados with (security_invoker = true) as
select
  a.id, a.nome, a.oab_numero, a.oab_uf,
  case when private.eh_admin_financeiro() then a.cpf_cnpj
       else private.mascarar_documento(a.cpf_cnpj) end as cpf_cnpj,
  a.email, a.telefone, a.percentual_padrao, a.papel_preferencial,
  case when private.eh_admin_financeiro() then a.chave_pix else null end as chave_pix,
  case when private.eh_admin_financeiro() then a.banco     else null end as banco,
  case when private.eh_admin_financeiro() then a.agencia   else null end as agencia,
  case when private.eh_admin_financeiro() then a.conta     else null end as conta,
  a.observacao, a.ativo, a.criado_em, a.criado_por, a.atualizado_em, a.atualizado_por
from advogados a;

create view vw_clientes with (security_invoker = true) as
select
  c.id, c.nome, c.tipo_pessoa,
  case when private.eh_admin_financeiro() then c.cpf_cnpj
       else private.mascarar_documento(c.cpf_cnpj) end as cpf_cnpj,
  c.email, c.telefone, c.cidade, c.uf, c.advogado_indicacao_id, c.percentual_indicacao,
  c.origem, c.data_cadastro, c.observacao, c.ativo,
  c.criado_em, c.criado_por, c.atualizado_em, c.atualizado_por
from clientes c;

-- Nota geral sobre as políticas de escrita abaixo: são sempre 3 políticas
-- separadas (insert/update/delete), nunca "for all" — "for all" também
-- se aplica a select e cria uma segunda política permissiva redundante com
-- a de leitura (a de leitura já cobre admin/financeiro), o que o linter do
-- Supabase reporta como "multiple_permissive_policies" (custo de performance:
-- cada policy permissiva roda e é combinada por OR em toda query).

-- ============================================================
-- RLS — advogados
-- ============================================================
alter table advogados enable row level security;

create policy advogados_leitura on advogados for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or (private.perfil_atual() = 'advogado' and id = private.advogado_atual())
);

create policy advogados_insert on advogados for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy advogados_update on advogados for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy advogados_delete on advogados for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — usuarios
-- Nota: perfil_atual()/advogado_atual() são security definer e não reaplicam
-- a RLS de `usuarios` durante sua própria execução, então não há recursão aqui.
-- ============================================================
alter table usuarios enable row level security;

create policy usuarios_leitura on usuarios for select to authenticated using (
  id = (select auth.uid()) or private.perfil_atual() in ('admin','financeiro')
);

create policy usuarios_insert on usuarios for insert to authenticated with check (
  private.perfil_atual() = 'admin'
);
create policy usuarios_update on usuarios for update to authenticated using (
  private.perfil_atual() = 'admin'
) with check (
  private.perfil_atual() = 'admin'
);
create policy usuarios_delete on usuarios for delete to authenticated using (
  private.perfil_atual() = 'admin'
);

-- ============================================================
-- RLS — clientes
-- ============================================================
alter table clientes enable row level security;

create policy clientes_leitura on clientes for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or (
    private.perfil_atual() = 'advogado'
    and exists (
      select 1 from lancamentos l
      join lancamento_rateio r on r.lancamento_id = l.id
      where l.cliente_id = clientes.id and r.advogado_id = private.advogado_atual()
    )
  )
);

create policy clientes_insert on clientes for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy clientes_update on clientes for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy clientes_delete on clientes for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — processos (mesmo padrão de clientes)
-- ============================================================
alter table processos enable row level security;

create policy processos_leitura on processos for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or (
    private.perfil_atual() = 'advogado'
    and exists (
      select 1 from lancamentos l
      join lancamento_rateio r on r.lancamento_id = l.id
      where l.processo_id = processos.id and r.advogado_id = private.advogado_atual()
    )
  )
);

create policy processos_insert on processos for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy processos_update on processos for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy processos_delete on processos for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — tipos_processo / tipos_servico (cadastro de referência, leitura ampla)
-- ============================================================
alter table tipos_processo enable row level security;

create policy tipos_processo_leitura on tipos_processo for select to authenticated using (true);

create policy tipos_processo_insert on tipos_processo for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy tipos_processo_update on tipos_processo for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy tipos_processo_delete on tipos_processo for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

alter table tipos_servico enable row level security;

create policy tipos_servico_leitura on tipos_servico for select to authenticated using (true);

create policy tipos_servico_insert on tipos_servico for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy tipos_servico_update on tipos_servico for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy tipos_servico_delete on tipos_servico for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — advogado_percentual
-- ============================================================
alter table advogado_percentual enable row level security;

create policy advogado_percentual_leitura on advogado_percentual for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or (private.perfil_atual() = 'advogado' and advogado_id = private.advogado_atual())
);

create policy advogado_percentual_insert on advogado_percentual for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy advogado_percentual_update on advogado_percentual for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy advogado_percentual_delete on advogado_percentual for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — lancamentos (exemplo dado literalmente na especificação §5.4,
-- adaptado para políticas separadas por comando — ver nota geral acima)
-- ============================================================
alter table lancamentos enable row level security;

create policy lanc_leitura on lancamentos for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or exists (select 1 from lancamento_rateio r
              where r.lancamento_id = lancamentos.id
                and r.advogado_id = private.advogado_atual())
);

create policy lanc_insert on lancamentos for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy lanc_update on lancamentos for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy lanc_delete on lancamentos for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — lancamento_rateio
-- A escrita real acontece via RPC security definer (rpc_salvar_lancamento);
-- estas políticas são defesa em profundidade contra escrita direta na tabela.
-- ============================================================
alter table lancamento_rateio enable row level security;

create policy rateio_leitura on lancamento_rateio for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio','leitura')
  or (private.perfil_atual() = 'advogado' and advogado_id = private.advogado_atual())
);

create policy rateio_insert on lancamento_rateio for insert to authenticated with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy rateio_update on lancamento_rateio for update to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
) with check (
  private.perfil_atual() in ('admin','financeiro')
);
create policy rateio_delete on lancamento_rateio for delete to authenticated using (
  private.perfil_atual() in ('admin','financeiro')
);

-- ============================================================
-- RLS — logs_auditoria (leitura conforme perfil; nenhuma escrita direta)
-- ============================================================
alter table logs_auditoria enable row level security;

create policy log_leitura on logs_auditoria for select to authenticated using (
  private.perfil_atual() in ('admin','financeiro','socio')
  or (
    private.perfil_atual() = 'advogado'
    and (
      usuario_id = (select auth.uid())
      or (
        entidade in ('lancamentos','lancamento_rateio')
        and registro_id in (
          select l.id from lancamentos l
          join lancamento_rateio r on r.lancamento_id = l.id
          where r.advogado_id = private.advogado_atual()
        )
      )
    )
  )
);

revoke insert, update, delete on logs_auditoria from authenticated, anon;
