// Cliente único do Supabase. SUPABASE_URL e SUPABASE_ANON_KEY são públicas por
// design (especificação §3.2) — protegidas pela RLS do banco, não por sigilo
// aqui. Trocar de projeto Supabase = editar estas duas constantes e fazer
// novo commit/deploy (não há build step para injetar env vars no client).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://upmhlzhmnzwkdghwffar.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwbWhsemhtbnp3a2RnaHdmZmFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MzM5MDYsImV4cCI6MjEwNTAwOTkwNn0.YJeOK6pb6oCJe8ljIPwyVn1g9gWmuYeGt3hX4jWyRME';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'honorarios-adv-auth',
  },
});
