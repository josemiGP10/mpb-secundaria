import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { PRINT_CSS, abrirVentana, reportEncabezado } from '../reportes/ReportesView';
import {
  CORTES, DECISIONES, periodosDe, analizar, areasARecuperar, asignaturasDeArea, conRecuperacion,
  decisionSugerida, guardarConfig, periodosIncompletos, areasCalificadasUltimoPeriodo, esPosibleDesertor, normalizarDecision,
  guardarDecision, idDecision, importarConsolidados, labelDecision, leerConfig, nombreArea, buscarEnDiario, construirIndiceDiario,
  type Analisis, type ConfigConsejo, type Corte, type Decision, type DecisionConsejo,
  type EstudianteConsejo, type GrupoConsejo,
} from './consejoService';
import { descargarListaExcel, htmlListas } from './listaEstados';

const etiquetaCorte = (c: Corte) => (c === 'FINAL' ? 'Nota final del año' : `Período ${c.slice(2)}`);
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

interface Fila {
  grupo: GrupoConsejo;
  est: EstudianteConsejo;
  an: Analisis;
  sugerida: Decision;
  retiradoDiario: boolean;     // figura como retirado en la matrícula del diario
  nombreDiario: string | null; // con qué nombre se encontró en la matrícula del diario
  desertor: boolean;           // posible desertor (por notas del último período o por asistencia del diario)
  motivoDesercion: string;     // por qué se marcó como posible desertor
  guardada?: DecisionConsejo;
  decision: Decision;          // la guardada o, si no hay, la sugerida
}

// ── Impresión ───────────────────────────────────────────────

const CSS_EXTRA = `
@page { size: letter portrait; margin: 12mm; }
h3 { font-size: 11px; margin: 14px 0 4px; }
.pg { page-break-before: always; }
.perd { color: #991b1b; font-weight: bold; }
.firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 28px 24px; margin-top: 40px; font-size: 9px; color: #444; }
.firmas div { border-top: 0.5px solid #555; text-align: center; padding-top: 3px; }
`;

function tablaResumen(filasPorGrupo: Map<GrupoConsejo, Fila[]>, cfg: ConfigConsejo): string {
  let t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, tt = 0;
  const filas = [...filasPorGrupo.entries()].map(([g, fs]) => {
    const c0 = fs.filter(f => !f.an.sinNingunaNota && f.an.perdidas.length === 0).length;
    const c1 = fs.filter(f => f.an.perdidas.length === 1).length;
    const c2 = fs.filter(f => f.an.perdidas.length >= 2 && f.an.perdidas.length < cfg.areasParaReprobar).length;
    const c3 = fs.filter(f => f.an.perdidas.length >= cfg.areasParaReprobar).length;
    const sn = fs.filter(f => f.an.sinNingunaNota).length;
    t1 += c0; t2 += c1; t3 += c2; t4 += c3; t5 += sn; tt += fs.length;
    return `<tr><td>${esc(g.nombre)}</td><td class="c">${fs.length}</td><td class="c">${c0}</td><td class="c">${c1}</td><td class="c">${c2}</td><td class="c perd">${c3}</td><td class="c">${sn}</td></tr>`;
  }).join('');
  const rango2 = cfg.areasParaReprobar > 2 ? `2${cfg.areasParaReprobar > 3 ? `–${cfg.areasParaReprobar - 1}` : ''} áreas` : '—';
  return `<table><thead><tr><th>Grupo</th><th>Estudiantes</th><th>Sin áreas perdidas</th><th>1 área</th><th>${rango2}</th><th>${cfg.areasParaReprobar}+ áreas</th><th>Sin notas</th></tr></thead>
    <tbody>${filas}<tr><th style="text-align:left">TOTAL</th><th>${tt}</th><th>${t1}</th><th>${t2}</th><th>${t3}</th><th>${t4}</th><th>${t5}</th></tr></tbody></table>`;
}

/** Texto de la decisión para el acta: incluye qué áreas recupera. */
function textoDecision(f: Fila): string {
  let html = `<b>${esc(labelDecision(f.decision))}</b>`;
  if (conRecuperacion(f.decision) && f.an.perdidas.length > 0) {
    const sel = areasARecuperar(f.an.perdidas, f.guardada);
    const notas = f.guardada?.notas_recuperacion ?? {};
    const no = f.an.perdidas.map(p => p.area).filter(a => !sel.includes(a));
    html += `<br>Recupera: ${sel.length ? sel.map(a => `${esc(a)}${notas[a] != null ? ` → ${fmt(notas[a])}` : ''}`).join(', ') : '—'}`;
    if (no.length) html += `<br><span style="color:#555">No se le exige: ${no.map(esc).join(', ')}</span>`;
  }
  if (f.guardada?.observacion) html += `<br><span style="color:#555">${esc(f.guardada.observacion)}</span>`;
  return html;
}

function imprimirActa(filasPorGrupo: Map<GrupoConsejo, Fila[]>, corte: Corte, cfg: ConfigConsejo, retiradosOcultos = 0): void {
  const detalle = [...filasPorGrupo.entries()].map(([g, fs]) => {
    const conCaso = fs.filter(f => f.an.perdidas.length > 0 || f.an.sinNingunaNota);
    const filas = conCaso.length === 0
      ? `<tr><td colspan="5" class="c">Ningún estudiante con áreas perdidas.</td></tr>`
      : conCaso.map((f, i) => `
        <tr><td class="num">${i + 1}</td>
        <td class="nombre">${esc(f.est.nombre)}</td>
        <td>${f.an.sinNingunaNota ? '<i>Sin notas registradas</i>' : f.an.perdidas.map(p => `<span class="perd">${esc(p.area)}</span> ${fmt(p.nota)}${p.incompleta ? '*' : ''}`).join(' · ')}</td>
        <td class="c">${f.an.perdidas.length}</td>
        <td>${textoDecision(f)}</td></tr>`).join('');
    return `<h3>${esc(g.nombre)} — ${conCaso.length} de ${fs.length} estudiantes con áreas perdidas</h3>
      <table><thead><tr><th class="num">#</th><th class="nombre">Estudiante</th><th>Áreas perdidas (nota)</th><th>N°</th><th>Decisión del consejo / observación</th></tr></thead>
      <tbody>${filas}</tbody></table>`;
  }).join('');

  abrirVentana(
    'Acta consejo académico',
    reportEncabezado(
      'Consejo Académico — Comisión de Evaluación y Promoción',
      etiquetaCorte(corte),
      `Área perdida: nota menor a ${cfg.notaMinima.toFixed(1)}`,
      false,
    ) +
      tablaResumen(filasPorGrupo, cfg) + detalle +
      (retiradosOcultos > 0 ? `<p style="margin-top:14px;font-size:9px;color:#555">No se incluyen ${retiradosOcultos} estudiantes que figuran como retirados en la matrícula del diario.</p>` : "") +
      ([...filasPorGrupo.keys()].some(g => g.estudiantes.some(e => e.finalCalculada)) && corte === "FINAL" ? `<p style="margin-top:14px;font-size:9px;color:#555">Nota final provisional (calculada por la app, la plataforma aún no la genera) en: ${[...filasPorGrupo.keys()].filter(g => g.estudiantes.some(e => e.finalCalculada)).map(g => esc(g.nombre)).join(", ")}.</p>` : "") +
      `<p style="margin-top:6px;font-size:9px;color:#555">* Nota final calculada con algún período sin nota en la plataforma (puede cambiar).</p>` +
      `<p style="margin-top:4px;font-size:9px;color:#555">Convenciones:${[...new Set([...filasPorGrupo.keys()].flatMap(g => g.areas))].map(a => `${esc(a)} = ${esc(nombreArea(a))}`).join(' · ')}</p>` +
      `<div class="firmas"><div>Rector(a)</div><div>Coordinador(a)</div><div>Secretario(a) del consejo</div><div>Docente</div><div>Docente</div><div>Docente</div></div>`,
    PRINT_CSS + CSS_EXTRA,
  );
}

function imprimirRecuperaciones(filasPorGrupo: Map<GrupoConsejo, Fila[]>, corte: Corte, cfg: ConfigConsejo): void {
  // Agrupar por área: qué estudiantes de qué grupo deben recuperarla
  // Entran: "Va a recuperación" (solo las áreas que escogió el consejo) y
  // los que siguen pendientes de decisión (todas sus áreas perdidas).
  const porArea = new Map<string, { g: GrupoConsejo; f: Fila; nota: number }[]>();
  for (const [g, fs] of filasPorGrupo) {
    for (const f of fs) {
      if (f.decision !== 'RECUPERACION' && f.decision !== 'PENDIENTE') continue;
      const sel = f.decision === 'RECUPERACION' ? areasARecuperar(f.an.perdidas, f.guardada) : f.an.perdidas.map(p => p.area);
      for (const p of f.an.perdidas) {
        if (!sel.includes(p.area)) continue;
        if (!porArea.has(p.area)) porArea.set(p.area, []);
        porArea.get(p.area)!.push({ g, f, nota: p.nota });
      }
    }
  }
  const areas = [...porArea.keys()].sort((a, b) => nombreArea(a).localeCompare(nombreArea(b), 'es'));
  if (areas.length === 0) { alert('No hay estudiantes pendientes de recuperación con los filtros actuales.'); return; }

  const bloques = areas.map((a, idx) => {
    const lista = porArea.get(a)!;
    const filas = lista.map((x, i) => {
      const asigs = asignaturasDeArea(x.g, a)
        .map(s => ({ s, v: x.f.est.asignaturas?.[corte]?.[s] ?? null }))
        .filter(o => o.v != null && o.v < cfg.notaMinima)
        .map(o => `${esc(o.s)} ${fmt(o.v)}`).join(' · ');
      return `<tr><td class="num">${i + 1}</td><td class="c">${esc(x.g.nombre)}</td><td class="nombre">${esc(x.f.est.nombre)}</td>
        <td class="c perd">${fmt(x.nota)}</td><td>${asigs || '—'}</td>
        <td class="c" style="width:70px;font-weight:bold">${x.f.guardada?.notas_recuperacion?.[a] != null ? fmt(x.f.guardada.notas_recuperacion[a]) : ''}</td></tr>`;
    }).join('');
    return `<div class="${idx > 0 ? 'pg' : ''}">
      ${reportEncabezado(`Plan de recuperación — ${esc(nombreArea(a))} (${esc(a)})`, etiquetaCorte(corte), `${lista.length} estudiantes`, false)}
      <table><thead><tr><th class="num">#</th><th>Grupo</th><th class="nombre">Estudiante</th><th>Nota área</th><th>Asignaturas en bajo</th><th>Nota recup.</th></tr></thead>
      <tbody>${filas}</tbody></table>
      <div class="firmas" style="grid-template-columns:1fr 1fr"><div>Docente(s) del área</div><div>Coordinación</div></div>
    </div>`;
  }).join('');
  abrirVentana('Recuperaciones por área', bloques, PRINT_CSS + CSS_EXTRA);
}

// ── Componente ──────────────────────────────────────────────

export function ConsejoView() {
  const [cfg, setCfg]                 = useState<ConfigConsejo>(leerConfig);
  const [corte, setCorte]             = useState<Corte>('FINAL');
  const [grupoSel, setGrupoSel]       = useState<string>('TODOS');
  const [soloCasos, setSoloCasos]     = useState(true);
  const [busqueda, setBusqueda]       = useState('');
  const [abiertos, setAbiertos]       = useState<Set<string>>(new Set());
  const [verCriterios, setVerCriterios] = useState(false);
  const [mostrarImport, setMostrarImport] = useState(false);
  const [fileAreas, setFileAreas]     = useState<File | null>(null);
  const [fileAsig, setFileAsig]       = useState<File | null>(null);
  const [importando, setImportando]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [reemplazarTodo, setReemplazarTodo] = useState(false);
  const [mostrarRetirados, setMostrarRetirados] = useState(false);

  const data = useLiveQuery(() => db.consejo_import.get('actual'), []);
  const decisiones = useLiveQuery(
    () => db.consejo_decisiones.where('corte').equals(corte).toArray(), [corte],
  );

  // Índice de la matrícula del diario (la misma de la lista de asistencia)
  // para saber qué estudiantes de la plataforma están retirados y cuáles
  // dejaron de asistir según la asistencia registrada en el diario.
  const indiceDiario = useLiveQuery(async () => {
    const anio = new Date().getFullYear();
    const mats = await db.matriculas.where('anio').equals(anio).toArray();
    const ests = await db.estudiantes.bulkGet([...new Set(mats.map(m => m.estudiante_id))]);
    const asis = await db.registros_asistencia.where('matricula_id').anyOf(mats.map(m => m.id)).toArray();
    return construirIndiceDiario(mats, new Map(ests.filter(e => !!e).map(e => [e!.id, e!])), asis);
  }, []);

  const cambiarCfg = (c: ConfigConsejo) => { setCfg(c); guardarConfig(c); };

  // Filas por grupo. Los retirados del diario se apartan (no salen en la
  // lista, el resumen ni el acta) salvo que se pida verlos.
  // `todasPorGrupo` incluye a los retirados: el listado de estados los lleva
  // (como en el de primaria), aunque en pantalla y en el acta se oculten.
  const { filasPorGrupo, todasPorGrupo, nRetiradosOcultos } = useMemo(() => {
    const mapa = new Map<GrupoConsejo, Fila[]>();
    const todas = new Map<GrupoConsejo, Fila[]>();
    let ocultos = 0;
    if (!data) return { filasPorGrupo: mapa, todasPorGrupo: todas, nRetiradosOcultos: 0 };
    const dec = new Map((decisiones ?? []).map(d => [d.id, d]));
    for (const g of data.grupos) {
      if (grupoSel !== 'TODOS' && g.clave !== grupoSel) continue;
      const ult = areasCalificadasUltimoPeriodo(g);
      const filas: Fila[] = [], completas: Fila[] = [];
      for (const est of g.estudiantes) {
        const enDiario = indiceDiario ? buscarEnDiario(est.nombre, indiceDiario.conjunto, indiceDiario.lista) : null;
        const retiradoDiario = !!enDiario && indiceDiario!.retirados.has(enDiario);
        const an = analizar(est, g, corte, cfg);
        const porNotas = esPosibleDesertor(est, ult);
        const asis = enDiario ? indiceDiario?.inasistentes.get(enDiario) : undefined;
        const desertor = !retiradoDiario && (porNotas || !!asis);
        const motivoDesercion = [
          porNotas ? `en el último período tiene 2.0 o menos (o sin nota) en la mitad o más de las áreas` : '',
          asis ? `en las últimas 4 semanas del diario faltó a ${asis.fallas} de ${asis.total} clases` : '',
        ].filter(Boolean).join('; ');
        const sugerida = retiradoDiario ? 'RETIRADO' : decisionSugerida(an, corte, cfg, desertor);
        const guardada = dec.get(idDecision(corte, g.clave, est.nombre));
        const fila: Fila = { grupo: g, est, an, sugerida, retiradoDiario, desertor, motivoDesercion, nombreDiario: enDiario, guardada, decision: guardada ? normalizarDecision(guardada.decision) : sugerida };
        completas.push(fila);
        if (retiradoDiario && !mostrarRetirados) { ocultos++; continue; }
        filas.push(fila);
      }
      mapa.set(g, filas);
      todas.set(g, completas);
    }
    return { filasPorGrupo: mapa, todasPorGrupo: todas, nRetiradosOcultos: ocultos };
  }, [data, decisiones, grupoSel, corte, cfg, indiceDiario, mostrarRetirados]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return [...filasPorGrupo.values()].flat()
      .filter(f => !soloCasos || f.an.perdidas.length > 0 || f.an.sinNingunaNota)
      .filter(f => !q || f.est.nombre.includes(q))
      .sort((a, b) => b.an.perdidas.length - a.an.perdidas.length || a.grupo.grado - b.grupo.grado || a.est.nombre.localeCompare(b.est.nombre, 'es'));
  }, [filasPorGrupo, soloCasos, busqueda]);

  const handleImportar = async () => {
    if (!fileAreas || importando) return;
    setImportando(true); setError(null);
    try {
      await importarConsolidados(fileAreas, fileAsig, reemplazarTodo);
      setMostrarImport(false); setFileAreas(null); setFileAsig(null); setReemplazarTodo(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportando(false);
    }
  };

  const aplicarSugeridas = async () => {
    const pendientes = visibles.filter(f => !f.guardada);
    if (pendientes.length === 0) return;
    if (!confirm(`Guardar la decisión sugerida para ${pendientes.length} estudiantes que aún no tienen decisión?`)) return;
    await db.consejo_decisiones.bulkPut(pendientes.map(f => ({
      id: idDecision(corte, f.grupo.clave, f.est.nombre), corte, grupo: f.grupo.clave, nombre: f.est.nombre,
      decision: f.sugerida, observacion: '', updated_at: new Date().toISOString(),
    })));
  };

  const toggle = (id: string) => setAbiertos(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // ── Sin datos todavía, o cargando nuevos archivos ──────────
  const panelImport = (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-3 w-full max-w-md">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Cargar consolidados de la plataforma</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Los Excel que exporta la plataforma de notas. Se leen en este equipo; no se suben a ningún lado.
        </p>
      </div>
      <label className="text-xs text-slate-600 flex flex-col gap-1">
        <span><b>1. Consolidado por áreas</b> (obligatorio) — consolidadoGruposAreasExcel</span>
        <input type="file" accept=".xlsx" style={{ color: "#334155" }} onChange={e => setFileAreas(e.target.files?.[0] ?? null)}
          className="text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700" />
      </label>
      <label className="text-xs text-slate-600 flex flex-col gap-1">
        <span><b>2. Consolidado por asignaturas</b> (opcional, para ver qué asignatura hizo perder el área)</span>
        <input type="file" accept=".xlsx" style={{ color: "#334155" }} onChange={e => setFileAsig(e.target.files?.[0] ?? null)}
          className="text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700" />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleImportar} disabled={!fileAreas || importando}
          className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40">
          {importando ? 'Leyendo...' : 'Cargar'}
        </button>
        {data && (
          <button onClick={() => { setMostrarImport(false); setError(null); }}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm">Cancelar</button>
        )}
      </div>
      {data && (
        <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-2">
          <p className="text-[11px] text-slate-500">
            <b>Ya cargados:</b> {data.grupos.map(g => g.nombre).join(' · ')}
          </p>
          <p className="text-[10px] text-slate-400">
            Los grupos del archivo nuevo se <b>agregan</b> a los ya cargados (así se cargan regulares y MEF, que vienen en
            consolidados distintos). Si un grupo ya estaba, se actualizan sus notas. Las decisiones y observaciones se conservan.
          </p>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <input type="checkbox" checked={reemplazarTodo} onChange={e => setReemplazarTodo(e.target.checked)} />
            Borrar los grupos ya cargados y dejar solo los de este archivo
          </label>
        </div>
      )}
    </div>
  );

  if (data === undefined && decisiones === undefined) {
    return <div className="flex-1 flex items-center justify-center p-10"><span className="w-6 h-6 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" /></div>;
  }

  if (!data || mostrarImport) {
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <div className="text-center">
          <div className="text-5xl mb-2">⚖</div>
          <h2 className="text-base font-semibold text-slate-800">Consejo Académico</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            Estudiantes con áreas perdidas, decisión del consejo (recupera, promovido, no promovido) y acta para imprimir.
          </p>
        </div>
        {panelImport}
      </div>
    );
  }

  const nCasos = [...filasPorGrupo.values()].flat().filter(f => f.an.perdidas.length > 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Barra de filtros */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        <div className="flex gap-1.5 flex-wrap items-center">
          <select value={grupoSel} onChange={e => setGrupoSel(e.target.value)}
            className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5">
            <option value="TODOS">Todos los grupos</option>
            {data.grupos.map(g => <option key={g.clave} value={g.clave}>{g.nombre}</option>)}
          </select>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {CORTES.map(c => (
              <button key={c} onClick={() => setCorte(c)}
                className={`px-2.5 py-1.5 text-xs font-medium ${corte === c ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {c === 'FINAL' ? 'Final' : c.replace('.', '')}
              </button>
            ))}
          </div>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar estudiante"
            className="flex-1 min-w-[120px] bg-white text-slate-900 border border-slate-300 text-xs rounded-lg px-2 py-1.5" />
        </div>
        <div className="flex gap-3 flex-wrap items-center text-xs text-slate-600">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={soloCasos} onChange={e => setSoloCasos(e.target.checked)} />
            Solo con áreas perdidas
          </label>
          <label className="flex items-center gap-1" title="Retirados según la matrícula del diario (la misma de la lista de asistencia)">
            <input type="checkbox" checked={mostrarRetirados} onChange={e => setMostrarRetirados(e.target.checked)} />
            Mostrar retirados{!mostrarRetirados && nRetiradosOcultos > 0 ? ` (${nRetiradosOcultos} ocultos)` : ''}
          </label>
          <button onClick={() => setVerCriterios(v => !v)} className="text-blue-600 hover:underline">⚙ Criterios</button>
          <button onClick={() => setMostrarImport(true)} className="text-blue-600 hover:underline">⤓ Cargar nuevos consolidados</button>
          <span className="text-[10px] text-slate-400 ml-auto">
            Datos: {new Date(data.importado_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {verCriterios && (
          <div className="flex gap-4 flex-wrap items-center text-xs text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
            <label className="flex items-center gap-1.5">
              Área perdida si la nota es menor a
              <input type="number" step={0.1} min={1} max={10} value={cfg.notaMinima}
                onChange={e => cambiarCfg({ ...cfg, notaMinima: Number(e.target.value) || cfg.notaMinima })}
                className="w-16 bg-white text-slate-900 border border-slate-300 rounded px-1.5 py-0.5" />
            </label>
            <label className="flex items-center gap-1.5">
              Sugerir "No promovido" con
              <input type="number" min={1} max={12} value={cfg.areasParaReprobar}
                onChange={e => cambiarCfg({ ...cfg, areasParaReprobar: Math.max(1, Number(e.target.value) || cfg.areasParaReprobar) })}
                className="w-14 bg-white text-slate-900 border border-slate-300 rounded px-1.5 py-0.5" />
              o más áreas perdidas (nota final)
            </label>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {/* Aviso: la plataforma no trajo la nota FINAL en algunos grupos */}
        {(() => {
          const calc = [...filasPorGrupo.keys()].filter(g => g.estudiantes.some(e => e.finalCalculada)).map(g => g.nombre);
          return corte === 'FINAL' && calc.length > 0 && (
            <div className="rounded-xl bg-blue-50 border border-blue-300 px-3 py-2 text-xs text-blue-900">
              <b>ℹ Nota final provisional en:</b> {calc.join(' · ')}.
              <span className="block text-blue-700 mt-0.5">
                La plataforma aún no generó la nota final de esos grupos (período abierto). La app la calculó como promedio
                de los períodos; casi siempre coincide, pero puede diferir unas décimas. Cuando la plataforma la genere,
                vuelva a cargar el consolidado.
              </span>
            </div>
          );
        })()}

        {/* Aviso: notas de período que faltan en la plataforma */}
        {(() => {
          const faltantes = [...filasPorGrupo.keys()].flatMap(g =>
            periodosIncompletos(g).map(x => `${g.nombre} – ${x.area} (${x.periodo.replace('.', '')}: faltan ${x.faltan})`));
          return faltantes.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">
              <b>⚠ Faltan notas en la plataforma:</b> {faltantes.join(' · ')}.
              <span className="block text-amber-700 mt-0.5">
                La nota final de esas áreas está incompleta y puede marcar como "perdida" un área que no lo es.
                Pida a los docentes subir las notas y vuelva a cargar el consolidado. Las áreas afectadas salen con *.
              </span>
            </div>
          );
        })()}

        {/* Resumen por grupo */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <thead className="bg-slate-100 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="text-left px-2 py-1.5">Grupo</th><th className="px-2">Est.</th>
                <th className="px-2">Sin pérdidas</th><th className="px-2">1 área</th>
                <th className="px-2">2+</th><th className="px-2">{cfg.areasParaReprobar}+ áreas</th><th className="px-2">Sin notas</th>
              </tr>
            </thead>
            <tbody>
              {[...filasPorGrupo.entries()].map(([g, fs]) => (
                <tr key={g.clave} className="border-t border-slate-100 text-center hover:bg-blue-50 cursor-pointer"
                  onClick={() => setGrupoSel(grupoSel === g.clave ? 'TODOS' : g.clave)}>
                  <td className="text-left px-2 py-1 font-medium">{g.nombre}</td>
                  <td>{fs.length}</td>
                  <td className="text-emerald-700">{fs.filter(f => !f.an.sinNingunaNota && f.an.perdidas.length === 0).length}</td>
                  <td className="text-amber-700">{fs.filter(f => f.an.perdidas.length === 1).length}</td>
                  <td className="text-amber-800">{fs.filter(f => f.an.perdidas.length >= 2 && f.an.perdidas.length < cfg.areasParaReprobar).length}</td>
                  <td className="text-red-700 font-semibold">{fs.filter(f => f.an.perdidas.length >= cfg.areasParaReprobar).length}</td>
                  <td className="text-slate-400">{fs.filter(f => f.an.sinNingunaNota).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Acciones */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => imprimirActa(filasPorGrupo, corte, cfg, nRetiradosOcultos)}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow hover:bg-blue-700">🖨 Acta del consejo</button>
          <button onClick={() => imprimirRecuperaciones(filasPorGrupo, corte, cfg)}
            className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold shadow hover:bg-amber-600">🖨 Recuperaciones por área</button>
          <button onClick={() => descargarListaExcel(todasPorGrupo, corte, cfg)}
            title="Formato institucional (como el de primaria): APROBADO, CURSANDO, REPROBADO, DESERTADO/RETIRADO. Una hoja por grupo."
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow hover:bg-emerald-700">⬇ Listado de estados (Excel)</button>
          <button onClick={() => abrirVentana('Listado de estados',
              htmlListas(todasPorGrupo, corte, cfg, g => reportEncabezado(`Listado de estados — ${g.nombre}`, etiquetaCorte(corte), `Reprueba con ${cfg.areasParaReprobar} o más áreas perdidas`, false)),
              PRINT_CSS + CSS_EXTRA)}
            className="px-4 py-2 rounded-xl bg-white border border-emerald-600 text-emerald-700 text-xs font-semibold hover:bg-emerald-50">🖨 Listado de estados</button>
          <button onClick={aplicarSugeridas}
            className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50">
            ✓ Aplicar sugeridas a los pendientes
          </button>
          <span className="text-xs text-slate-500 self-center">{nCasos} estudiantes con áreas perdidas · {etiquetaCorte(corte)}</span>
        </div>

        {/* Lista de estudiantes */}
        {visibles.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">Ningún estudiante con áreas perdidas en este corte. 🎉</p>
        )}
        {visibles.map(f => {
          const id = idDecision(corte, f.grupo.clave, f.est.nombre);
          const abierto = abiertos.has(id);
          const color = DECISIONES.find(d => d.id === f.decision)?.color ?? '';
          return (
            <div key={id} className="rounded-xl bg-white border border-slate-200 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-blue-800 bg-blue-100 rounded px-1.5 py-0.5">{f.grupo.nombre}</span>
                {f.retiradoDiario && (
                  <span className="text-[10px] font-bold text-slate-700 bg-slate-200 rounded px-1.5 py-0.5"
                    title={`Retirado en la matrícula del Diario Pedagógico como: ${f.nombreDiario ?? ""}`}>Retirado en el diario{f.nombreDiario && f.nombreDiario !== f.est.nombre ? ` (${f.nombreDiario})` : ""}</span>
                )}
                {f.desertor && (
                  <span className="text-[10px] font-bold text-yellow-900 bg-yellow-200 rounded px-1.5 py-0.5"
                    title={`Posible desertor: ${f.motivoDesercion}`}>
                    Posible desertor{f.motivoDesercion.includes("faltó") ? " (asistencia)" : " (notas)"}
                  </span>
                )}
                <button onClick={() => toggle(id)} className="flex-1 text-left text-sm font-semibold text-slate-800 min-w-[180px]">
                  {f.est.nombre} <span className="text-slate-400 text-xs font-normal">{abierto ? '▲' : '▼'}</span>
                </button>
                <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${f.an.perdidas.length >= cfg.areasParaReprobar ? 'bg-red-600 text-white' : f.an.perdidas.length > 0 ? 'bg-amber-400 text-amber-950' : 'bg-slate-200 text-slate-600'}`}>
                  {f.an.sinNingunaNota ? 'Sin notas' : `${f.an.perdidas.length} área${f.an.perdidas.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {f.an.perdidas.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {f.an.perdidas.map(p => (
                    <span key={p.area}
                      title={`${nombreArea(p.area)}${p.incompleta ? ' — falta la nota de algún período; la final puede cambiar' : ''}`}
                      className={`text-xs rounded-md border px-2 py-0.5 ${p.incompleta ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                      {nombreArea(p.area)} <b>{fmt(p.nota)}</b>{p.incompleta && ' *'}
                    </span>
                  ))}
                  {f.an.sinNota.length > 0 && !f.an.sinNingunaNota && (
                    <span className="text-[11px] text-slate-400 px-1">sin nota: {f.an.sinNota.map(nombreArea).join(', ')}</span>
                  )}
                </div>
              )}

              <div className="flex gap-2 flex-wrap items-center">
                <select value={f.decision}
                  onChange={e => guardarDecision(corte, f.grupo.clave, f.est.nombre, { decision: e.target.value as Decision })}
                  className={`text-xs rounded-lg px-2 py-1.5 border border-slate-300 font-semibold ${color}`}>
                  {DECISIONES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                {!f.guardada && <span className="text-[10px] text-slate-400">sugerida — aún sin confirmar</span>}
                {f.guardada && f.decision !== f.sugerida && (
                  <span className="text-[10px] text-violet-800 bg-violet-100 rounded px-1.5 py-0.5 flex items-center gap-1.5">
                    Decisión del consejo · la regla indicaba: <b>{labelDecision(f.sugerida)}</b>
                    <button
                      onClick={() => guardarDecision(corte, f.grupo.clave, f.est.nombre, { decision: f.sugerida })}
                      className="underline text-violet-700 hover:text-violet-900">Volver a la sugerida</button>
                  </span>
                )}
                <ObservacionInput
                  valor={f.guardada?.observacion ?? ''}
                  onGuardar={v => guardarDecision(corte, f.grupo.clave, f.est.nombre, { observacion: v, decision: f.decision })} />
              </div>

              {conRecuperacion(f.decision) && f.an.perdidas.length > 0 && (
                <AreasRecuperacion f={f} corte={corte} cfg={cfg} />
              )}

              {abierto && <Detalle f={f} corte={corte} cfg={cfg} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Selección de las áreas que el consejo decide que el estudiante
 *  recupera, y la nota que obtuvo en cada recuperación. */
function AreasRecuperacion({ f, corte, cfg }: { f: Fila; corte: Corte; cfg: ConfigConsejo }) {
  const sel = areasARecuperar(f.an.perdidas, f.guardada);
  const notas = f.guardada?.notas_recuperacion ?? {};
  const guardar = (cambios: Parameters<typeof guardarDecision>[3]) =>
    guardarDecision(corte, f.grupo.clave, f.est.nombre, { decision: f.decision, ...cambios });

  const alternar = (area: string) => {
    const nueva = sel.includes(area) ? sel.filter(a => a !== area) : [...sel, area];
    guardar({ areas_recuperar: nueva });
  };
  const ponerNota = (area: string, v: string) => {
    const n = { ...notas };
    const num = Number(v.replace(',', '.'));
    if (v.trim() === '' || Number.isNaN(num)) delete n[area]; else n[area] = Math.min(10, Math.max(0, num));
    guardar({ notas_recuperacion: n });
  };

  const conNota = sel.filter(a => notas[a] != null);
  const aprobo = sel.length > 0 && sel.every(a => (notas[a] ?? -1) >= cfg.notaMinima);

  return (
    <div className="rounded-lg bg-amber-50/60 border border-amber-200 px-2.5 py-2 flex flex-col gap-1.5">
      <p className="text-[11px] text-amber-900 font-semibold">
        Áreas que va a recuperar <span className="font-normal text-amber-700">(toque para marcar o quitar)</span>
      </p>
      <div className="flex flex-col gap-1">
        {f.an.perdidas.map(p => {
          const activa = sel.includes(p.area);
          const nr = notas[p.area];
          return (
            <div key={p.area} className="flex items-center gap-2 flex-wrap">
              <button onClick={() => alternar(p.area)}
                className={`text-xs rounded-md border px-2 py-1 text-left min-w-[200px] transition-colors ${activa
                  ? 'bg-amber-200 border-amber-400 text-amber-950 font-semibold'
                  : 'bg-white border-slate-200 text-slate-400 line-through'}`}>
                {activa ? '☑' : '☐'} {nombreArea(p.area)} <b>{fmt(p.nota)}</b>
              </button>
              {activa && (
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  Nota recuperación:
                  <NotaInput valor={nr} onGuardar={v => ponerNota(p.area, v)} />
                  {nr != null && (
                    <span className={`font-bold ${nr >= cfg.notaMinima ? 'text-emerald-700' : 'text-red-700'}`}>
                      {nr >= cfg.notaMinima ? '✓ recuperó' : '✗ no alcanzó'}
                    </span>
                  )}
                </label>
              )}
              {!activa && <span className="text-[10px] text-slate-400">el consejo no se la exige</span>}
            </div>
          );
        })}
      </div>
      {f.decision === 'RECUPERACION' && aprobo && conNota.length === sel.length && (
        <button onClick={() => guardar({ decision: 'RECUPERO' })}
          className="self-start text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700">
          ✓ Recuperó todas las áreas → marcar "Recuperó → promovido"
        </button>
      )}
    </div>
  );
}

function NotaInput({ valor, onGuardar }: { valor: number | undefined; onGuardar: (v: string) => void }) {
  const txt = valor != null ? String(valor) : '';
  const [v, setV] = useState(txt);
  useEffect(() => { setV(txt); }, [txt]);
  return (
    <input value={v} inputMode="decimal" placeholder="—"
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== txt) onGuardar(v); }}
      className="w-14 text-xs text-slate-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-center" />
  );
}

/** Campo de observación: edita en local y guarda al salir del campo.
 *  Se sincroniza si el valor guardado llega o cambia después. */
function ObservacionInput({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => void }) {
  const [v, setV] = useState(valor);
  useEffect(() => { setV(valor); }, [valor]);
  return (
    <input
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== valor) onGuardar(v); }}
      placeholder="Observación / compromiso"
      className="flex-1 min-w-[160px] text-xs text-slate-900 bg-white border border-slate-300 rounded-lg px-2 py-1.5" />
  );
}

function Detalle({ f, corte, cfg }: { f: Fila; corte: Corte; cfg: ConfigConsejo }) {
  const cols: Corte[] = [...periodosDe(f.grupo), 'FINAL'];
  const celda = (v: number | null | undefined, resaltar: boolean) => (
    <td className={`px-1.5 py-0.5 text-center ${v != null && v < cfg.notaMinima ? 'text-red-700 font-semibold' : ''} ${resaltar ? 'bg-blue-50' : ''}`}>{fmt(v)}</td>
  );
  const perdidas = new Set(f.an.perdidas.map(p => p.area));
  return (
    <div className="overflow-x-auto border-t border-slate-100 pt-2">
      <table className="text-[11px] text-slate-700 w-full">
        <thead className="text-slate-400">
          <tr><th className="text-left px-1.5">Área / asignatura</th>{cols.map(c => <th key={c} className="px-1.5">{c === 'FINAL' ? 'Final' : c.replace('.', '')}</th>)}</tr>
        </thead>
        <tbody>
          {f.grupo.areas.map(a => (
            <Fragment key={a}>
              <tr className={`border-t border-slate-100 ${perdidas.has(a) ? 'bg-red-50/50' : ''}`}>
                <td className="px-1.5 py-0.5 font-semibold">{nombreArea(a)} <span className="text-slate-400 font-normal">{a}</span></td>
                {cols.map(c => celda(f.est.areas[c]?.[a], c === corte))}
              </tr>
              {perdidas.has(a) && f.est.asignaturas && asignaturasDeArea(f.grupo, a).map(s => (
                <tr key={`${a}-${s}`} className="text-slate-500">
                  <td className="pl-5 py-0.5">↳ {s}</td>
                  {cols.map(c => celda(f.est.asignaturas?.[c]?.[s], c === corte))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
