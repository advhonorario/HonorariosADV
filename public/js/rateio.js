// Algoritmos puros (sem DOM) usados pela tela de lançamento. Espelham
// exatamente a lógica do banco — CLAUDE.md exige que o mesmo algoritmo rode
// no navegador (pré-visualização) e no Postgres (gravação); o servidor
// continua sendo a fonte da verdade em caso de divergência.

// Resolução do percentual sugerido (especificação §4.4), do mais específico
// para o mais genérico:
//   1. exceção advogado+processo+serviço
//   2. exceção advogado+serviço
//   3. exceção advogado+processo
//   4. advogados.percentual_padrao
//   5. tipos_servico.percentual_sugerido
//   6. zero
export function resolverPercentualSugerido({ tipoProcessoId, tipoServicoId, excecoes, advogado, tipoServico }) {
  const lista = excecoes ?? [];
  const porProcessoEServico = lista.find(
    (e) => e.ativo !== false && e.tipo_processo_id === tipoProcessoId && e.tipo_servico_id === tipoServicoId
  );
  if (porProcessoEServico) return { percentual: Number(porProcessoEServico.percentual), origem: 'manual' };

  const porServico = lista.find(
    (e) => e.ativo !== false && e.tipo_processo_id == null && e.tipo_servico_id === tipoServicoId
  );
  if (porServico) return { percentual: Number(porServico.percentual), origem: 'padrao_servico' };

  const porProcesso = lista.find(
    (e) => e.ativo !== false && e.tipo_processo_id === tipoProcessoId && e.tipo_servico_id == null
  );
  if (porProcesso) return { percentual: Number(porProcesso.percentual), origem: 'padrao_advogado' };

  // `percentual_padrao` é `not null default 0` no banco — todo advogado tem um
  // valor, então "zero" é tratado como "nunca configurado" e cai para o próximo
  // nível (tipos_servico.percentual_sugerido), não como um 0% definitivo.
  if (advogado?.percentual_padrao != null && Number(advogado.percentual_padrao) > 0) {
    return { percentual: Number(advogado.percentual_padrao), origem: 'padrao_advogado' };
  }

  if (tipoServico?.percentual_sugerido != null) {
    return { percentual: Number(tipoServico.percentual_sugerido), origem: 'padrao_servico' };
  }

  return { percentual: 0, origem: 'manual' };
}

// Arredondamento por maior resto (especificação §4.8), porta exata do
// algoritmo em supabase/migrations/008_rpcs.sql:107-148 — piso em centavos
// inteiros por linha + distribuição do resíduo pela maior fração descartada,
// desempate por advogado_id. `linhas`: [{ advogadoId, papel, percentual }].
// Retorna cada linha com `valor` (number, em reais) e o residual do
// escritório sempre por diferença, nunca por percentual.
export function calcularRateioMaiorResto(valorBase, linhas) {
  const baseCentavos = Math.round(Number(valorBase) * 100);
  const somaPercentual = linhas.reduce((acc, l) => acc + Number(l.percentual || 0), 0);
  const alvoCentavos = Math.round((baseCentavos * somaPercentual) / 100);

  const calculadas = linhas.map((l) => {
    const bruto = (baseCentavos * Number(l.percentual || 0)) / 100;
    const piso = Math.floor(bruto);
    return { ...l, piso, fracao: bruto - piso };
  });

  const somaPisos = calculadas.reduce((acc, l) => acc + l.piso, 0);
  const residuo = alvoCentavos - somaPisos;

  const ordenadas = calculadas
    .map((l, indice) => ({ indice, l }))
    .sort((a, b) => (b.l.fracao - a.l.fracao) || String(a.l.advogadoId).localeCompare(String(b.l.advogadoId)));

  const centavosExtras = new Set(ordenadas.slice(0, Math.max(residuo, 0)).map((x) => x.indice));

  const comValor = calculadas.map((l, indice) => ({
    advogadoId: l.advogadoId,
    papel: l.papel,
    percentual: l.percentual,
    valor: (l.piso + (centavosExtras.has(indice) ? 1 : 0)) / 100,
  }));

  const somaValores = comValor.reduce((acc, l) => acc + l.valor, 0);
  const residualEscritorio = Math.round((Number(valorBase) - somaValores) * 100) / 100;

  return { linhas: comValor, residualEscritorio, somaPercentual };
}
