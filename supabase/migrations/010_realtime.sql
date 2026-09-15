-- Habilita Realtime (postgres_changes) para as tabelas de cadastro consumidas
-- por public/js/store.js (especificação §10: cache em Map revalidado por
-- Realtime). Sem isso, a publicação `supabase_realtime` fica vazia e nenhum
-- evento é entregue ao client — os comboboxes/listas só atualizavam com F5.
alter publication supabase_realtime add table public.advogados;
alter publication supabase_realtime add table public.tipos_processo;
alter publication supabase_realtime add table public.tipos_servico;
