import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { PRINT_CSS, abrirVentana, reportEncabezado } from '../reportes/ReportesView';
import {
  CORTES, DECISIONES, periodosDe, analizar, areasARecuperar, asignaturasDeArea, conRecuperacion,
  decisionSugerida, guardarConfig, periodosIncompletos, areasCalificadasUltimoPeriodo, esPosibleDesertor, normalizarDecision,
  guardarDecision, idDecision, importarConsolidados, labelDecision, leerConfig, nombreArea, buscarEnDiario, construirIndiceDiario,
  importarListaEstados, normalizarNombre, comisionDe, leerComisiones, guardarComisiones,
  type Analisis, type ConfigConsejo, type Corte, type Decision, type DecisionConsejo,
  type EstudianteConsejo, type GrupoConsejo, type Comision, type EstadoInstitucional,
} from './consejoService';

/** Etapas del proceso: preconsejo interno → comisiones → resultados para firma. */
type Etapa = 'PRECONSEJO' | 'COMISIONES' | 'RESULTADOS';
const ETAPAS: { id: Etapa; titulo: string; ayuda: string }[] = [
  { id: 'PRECONSEJO', titulo: '1 · Preconsejo', ayuda: 'Interno. Se puede ayudar a un estudiante subiendo un área a la nota mínima: en pantalla queda marcado, pero en lo impreso no queda rastro. Al final se imprime el listado que va al consejo.' },
  { id: 'COMISIONES', titulo: '2 · Comisiones', ayuda: 'Cada comisión revisa sus grados. A quien perdió 3 o más áreas se le puede corregir una nota (y pasa a recuperar) o confirmar que pierde el año.' },
  { id: 'RESULTADOS', titulo: '3 · Resultados', ayuda: 'Listados finales por grado con las firmas de los miembros de cada comisión.' },
];
import { descargarListaExcel, htmlListas, type OpcionesImpresion } from './listaEstados';

const etiquetaCorte = (c: Corte) => (c === 'FINAL' ? 'Nota final del año' : `Período ${c.slice(2)}`);
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));

interface Fila {
  grupo: GrupoConsejo;
  est: EstudianteConsejo;
  an: Analisis;
  sugerida: Decision;
  retiradoDiario: boolean;     // figura como retirado en la matrícula del diario
  retiradoLista: string | null; // DESERTADO/RETIRADO según el listado externo (LISTA 2026)
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
.firmas-tabla { width: 100%; margin-top: 18px; border-collapse: collapse; }
.firmas-tabla td, .firmas-tabla th { border: 0.5px solid #888; padding: 10px 6px; font-size: 10px; }
.firmas-tabla th { background: #e0e0e0; font-size: 9px; padding: 4px 6px; }
`;

/** Bloque de firmas de la comisión que corresponde al grado. */
function bloqueFirmas(com: Comision | undefined): string {
  if (!com) return '';
  return `<table class="firmas-tabla">
    <thead><tr><th colspan="3">Comisión de evaluación y promoción ${esc(com.nombre)}</th></tr>
    <tr><th style="width:34%">Cargo</th><th style="width:33%">Nombre</th><th>Firma</th></tr></thead>
    <tbody>${com.miembros.map(m => `<tr><td>${esc(m.rol)}</td><td>${esc(m.nombre)}</td><td></td></tr>`).join('')}</tbody>
  </table>`;
}

function imprimirListas(
  titulo: string, porGrupo: Map<GrupoConsejo, Fila[]>, corte: Corte, cfg: ConfigConsejo,
  comisiones: Comision[] | null,   // con comisiones → resultados para firma
  opciones: OpcionesImpresion = {},
): void {
  if (porGrupo.size === 0) { alert('No hay grupos con los filtros actuales.'); return; }
  const html = htmlListas(porGrupo, corte, cfg,
    g => reportEncabezado(`${titulo} — ${g.nombre}`, etiquetaCorte(corte),
      comisiones ? `Comisión ${comisiones.find(c => c.id === comisionDe(g))?.nombre ?? ''}` : '', false),
    comisiones ? g => bloqueFirmas(comisiones.find(c => c.id === comisionDe(g))) : undefined,
    opciones);
  abrirVentana(titulo, html, PRINT_CSS + CSS_EXTRA);
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
  const [etapa, setEtapa]             = useState<Etapa>('PRECONSEJO');
  const [comSel, setComSel]           = useState<string>('TODAS');
  const [soloPierden, setSoloPierden] = useState(false);
  const [comisiones, setComisiones]   = useState<Comision[]>(leerComisiones);
  const [fileLista, setFileLista]     = useState<File | null>(null);
  const [msgLista, setMsgLista]       = useState<string | null>(null);
  const cambiarComisiones = (c: Comision[]) => { setComisiones(c); guardarComisiones(c); };
  // Estados que salen en el acta de la comisión (por defecto: reprobados y a nivelar)
  const [estadosActa, setEstadosActa] = useState<EstadoInstitucional[]>(() => {
    try { const r = localStorage.getItem('mpb_sec_consejo_estados_acta'); if (r) return JSON.parse(r); } catch { /* sin almacenamiento */ }
    return ['REPROBADO', 'CURSANDO'];
  });
  const cambiarEstadosActa = (e: EstadoInstitucional[]) => {
    setEstadosActa(e);
    try { localStorage.setItem('mpb_sec_consejo_estados_acta', JSON.stringify(e)); } catch { /* sin almacenamiento */ }
  };

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
    // Retirados/desertados del listado externo (primaria, Aceleración…)
    const externos = new Map((data.retiradosExternos ?? []).map(x => [normalizarNombre(x.nombre), x.estado]));
    const extLista = [...externos.keys()];
    for (const g of data.grupos) {
      if (grupoSel !== 'TODOS' && g.clave !== grupoSel) continue;
      if (comSel !== 'TODAS' && comisionDe(g) !== comSel) continue;
      const ult = areasCalificadasUltimoPeriodo(g);
      const filas: Fila[] = [], completas: Fila[] = [];
      for (const est of g.estudiantes) {
        const enDiario = indiceDiario ? buscarEnDiario(est.nombre, indiceDiario.conjunto, indiceDiario.lista) : null;
        const retiradoDiario = !!enDiario && indiceDiario!.retirados.has(enDiario);
        const enLista = extLista.length ? buscarEnDiario(est.nombre, new Set(extLista), extLista) : null;
        const retiradoLista = enLista ? externos.get(enLista) ?? null : null;
        const retirado = retiradoDiario || !!retiradoLista;
        const guardada = dec.get(idDecision(corte, g.clave, est.nombre));
        const an = analizar(est, g, corte, cfg, guardada?.ajustes);
        const porNotas = esPosibleDesertor(est, ult);
        const asis = enDiario ? indiceDiario?.inasistentes.get(enDiario) : undefined;
        const desertor = !retirado && (porNotas || !!asis);
        const motivoDesercion = [
          porNotas ? `en el último período tiene 2.0 o menos (o sin nota) en la mitad o más de las áreas` : '',
          asis ? `en las últimas 4 semanas del diario faltó a ${asis.fallas} de ${asis.total} clases` : '',
        ].filter(Boolean).join('; ');
        const sugerida = retirado ? 'RETIRADO' : decisionSugerida(an, corte, cfg, desertor);
        const fila: Fila = {
          grupo: g, est, an, sugerida, retiradoDiario, retiradoLista, desertor, motivoDesercion, nombreDiario: enDiario, guardada,
          decision: guardada?.decision ? normalizarDecision(guardada.decision) : sugerida,
        };
        completas.push(fila);
        if (retirado && !mostrarRetirados) { ocultos++; continue; }
        filas.push(fila);
      }
      mapa.set(g, filas);
      todas.set(g, completas);
    }
    return { filasPorGrupo: mapa, todasPorGrupo: todas, nRetiradosOcultos: ocultos };
  }, [data, decisiones, grupoSel, comSel, corte, cfg, indiceDiario, mostrarRetirados]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return [...filasPorGrupo.values()].flat()
      // Los que tienen notas ajustadas siguen visibles aunque ya no pierdan áreas
      .filter(f => !soloCasos || f.an.perdidas.length > 0 || f.an.sinNingunaNota || f.an.ajustadas.length > 0)
      .filter(f => !(etapa === 'COMISIONES' && soloPierden) || f.an.perdidas.length >= cfg.areasParaReprobar || f.decision === 'NO_PROMOVIDO')
      .filter(f => !q || f.est.nombre.includes(q))
      .sort((a, b) => b.an.perdidas.length - a.an.perdidas.length || a.grupo.grado - b.grupo.grado || a.est.nombre.localeCompare(b.est.nombre, 'es'));
  }, [filasPorGrupo, soloCasos, busqueda, etapa, soloPierden, cfg]);

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
    const pendientes = visibles.filter(f => !f.guardada?.decision);
    if (pendientes.length === 0) return;
    if (!confirm(`Guardar la decisión sugerida para ${pendientes.length} estudiantes que aún no tienen decisión?`)) return;
    await db.consejo_decisiones.bulkPut(pendientes.map(f => ({
      ...(f.guardada ?? { observacion: '' }),   // conserva ajustes y observaciones
      id: idDecision(corte, f.grupo.clave, f.est.nombre), corte, grupo: f.grupo.clave, nombre: f.est.nombre,
      decision: f.sugerida, updated_at: new Date().toISOString(),
    })));
  };

  const handleCargarLista = async () => {
    if (!fileLista) return;
    setMsgLista(null);
    try {
      const n = await importarListaEstados(fileLista);
      setMsgLista(`✓ ${n} estudiantes desertados o retirados leídos de ${fileLista.name}.`);
      setFileLista(null);
    } catch (e) {
      setMsgLista(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Ayudar: sube un área a la nota mínima (o quita el ajuste). */
  const ajustarArea = (f: Fila, area: string, valor: number | null) => {
    const ajustes = { ...(f.guardada?.ajustes ?? {}) };
    if (valor == null) delete ajustes[area]; else ajustes[area] = valor;
    // Al ajustar, si la decisión era la sugerida, se deja que se recalcule
    return guardarDecision(corte, f.grupo.clave, f.est.nombre, { ajustes, ...(f.guardada?.decision === f.sugerida ? { quitarDecision: true } : {}) });
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
      <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-2">
        <span className="text-xs text-slate-600">
          <b>3. Listado de estados con retirados</b> (opcional) — p. ej. <i>LISTA 2026.xlsx</i> de primaria. Se toman los
          marcados <b>DESERTADO</b> o <b>RETIRADO</b>, para los grupos que no están en el diario (primaria, Aceleración).
        </span>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="file" accept=".xlsx" style={{ color: "#334155" }} onChange={e => setFileLista(e.target.files?.[0] ?? null)}
            className="text-xs flex-1 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700" />
          <button onClick={handleCargarLista} disabled={!fileLista}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-semibold disabled:opacity-40">Cargar listado</button>
        </div>
        {msgLista && <p className="text-[11px] text-slate-600">{msgLista}</p>}
        {data?.retiradosExternos && (
          <p className="text-[10px] text-slate-400">
            Cargado: {data.retiradosExternos.length} retirados/desertados de {data.archivo_lista}. Cargar otro listado lo reemplaza.
          </p>
        )}
      </div>
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
            Preconsejo, comisiones de evaluación y listados finales por grado para firma.
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
        {/* Etapas del proceso */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden self-start">
          {ETAPAS.map(x => (
            <button key={x.id} onClick={() => setEtapa(x.id)} title={x.ayuda}
              className={`px-3 py-1.5 text-xs font-semibold ${etapa === x.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {x.titulo}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 -mt-0.5">{ETAPAS.find(x => x.id === etapa)!.ayuda}</p>
        <div className="flex gap-1.5 flex-wrap items-center">
          <select value={comSel} onChange={e => { setComSel(e.target.value); setGrupoSel('TODOS'); }}
            className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5">
            <option value="TODAS">Todas las comisiones</option>
            {comisiones.map(c => <option key={c.id} value={c.id}>Comisión {c.nombre}</option>)}
          </select>
          <select value={grupoSel} onChange={e => setGrupoSel(e.target.value)}
            className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5">
            <option value="TODOS">Todos los grupos</option>
            {data.grupos.filter(g => comSel === 'TODAS' || comisionDe(g) === comSel)
              .map(g => <option key={g.clave} value={g.clave}>{g.nombre}</option>)}
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
          {etapa === 'COMISIONES' && (
            <label className="flex items-center gap-1 font-semibold text-red-700">
              <input type="checkbox" checked={soloPierden} onChange={e => setSoloPierden(e.target.checked)} />
              Solo los que pierden el año ({cfg.areasParaReprobar}+ áreas)
            </label>
          )}
          <label className="flex items-center gap-1" title="Retirados según la matrícula del diario y el listado de estados cargado">
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
            <details className="w-full">
              <summary className="cursor-pointer text-blue-700">👥 Miembros de las comisiones (salen en los resultados para firma)</summary>
              <div className="grid sm:grid-cols-2 gap-3 mt-2">
                {comisiones.map((c, ci) => (
                  <div key={c.id} className="bg-white rounded-lg border border-slate-200 p-2">
                    <p className="font-semibold text-slate-800 mb-1">Comisión {c.nombre}</p>
                    {c.miembros.map((m, mi) => (
                      <label key={mi} className="flex items-center gap-1.5 mb-1">
                        <span className="w-44 text-[11px] text-slate-500">{m.rol}</span>
                        <input value={m.nombre}
                          onChange={e => cambiarComisiones(comisiones.map((cc, i) => i !== ci ? cc : {
                            ...cc, miembros: cc.miembros.map((mm, j) => j !== mi ? mm : { ...mm, nombre: e.target.value.toUpperCase() }),
                          }))}
                          className="flex-1 bg-white text-slate-900 border border-slate-300 rounded px-1.5 py-0.5 text-[11px]" />
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </details>
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

        {/* Acciones según la etapa. Nada impreso muestra los ajustes de nota
            ni las observaciones internas: solo el resultado. */}
        <div className="flex gap-2 flex-wrap">
          {etapa !== 'RESULTADOS' && (
            <button onClick={() => imprimirListas('Listado para el Consejo Académico', todasPorGrupo, corte, cfg, null)}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow hover:bg-blue-700">🖨 Listado para el consejo</button>
          )}
          {etapa === 'RESULTADOS' && (
            <button onClick={() => imprimirListas('Resultados de evaluación y promoción', todasPorGrupo, corte, cfg, comisiones,
                { estados: estadosActa, textos: { CURSANDO: 'NIVELAR' } })}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow hover:bg-blue-700">🖨 Acta de la comisión (por grado)</button>
          )}
          {etapa === 'RESULTADOS' && (
            <span className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              En el acta:
              {([['REPROBADO', 'Reprobados'], ['CURSANDO', 'Nivelar'], ['RETIRADO', 'Desertados/retirados'], ['APROBADO', 'Aprobados']] as const).map(([e, t]) => (
                <label key={e} className="flex items-center gap-1">
                  <input type="checkbox" checked={estadosActa.includes(e)}
                    onChange={ev => cambiarEstadosActa(ev.target.checked ? [...estadosActa, e] : estadosActa.filter(x => x !== e))} />
                  {t}
                </label>
              ))}
            </span>
          )}
          <button onClick={() => descargarListaExcel(todasPorGrupo, corte, cfg)}
            title="Formato institucional (como el de primaria): APROBADO, CURSANDO, REPROBADO, DESERTADO/RETIRADO. Una hoja por grupo."
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow hover:bg-emerald-700">⬇ Listado (Excel)</button>
          {etapa === 'RESULTADOS' && (
            <button onClick={() => imprimirRecuperaciones(filasPorGrupo, corte, cfg)}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold shadow hover:bg-amber-600">🖨 Recuperaciones por área</button>
          )}
          {etapa !== 'RESULTADOS' && (
            <button onClick={aplicarSugeridas}
              className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50">
              ✓ Aplicar sugeridas a los pendientes
            </button>
          )}
          <span className="text-xs text-slate-500 self-center">
            {nCasos} con áreas perdidas · {[...filasPorGrupo.values()].flat().filter(f => f.an.ajustadas.length > 0).length} con notas ajustadas · {etiquetaCorte(corte)}
          </span>
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
                {f.retiradoLista && !f.retiradoDiario && (
                  <span className="text-[10px] font-bold text-slate-700 bg-slate-200 rounded px-1.5 py-0.5"
                    title={`Marcado ${f.retiradoLista} en ${data.archivo_lista ?? 'el listado de estados'}`}>
                    {f.retiradoLista === 'RETIRADO' ? 'Retirado' : 'Desertado'} (listado)
                  </span>
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

              {(f.an.perdidas.length > 0 || f.an.ajustadas.length > 0) && (
                <div className="flex gap-1 flex-wrap items-center">
                  {f.an.perdidas.map(p => (
                    <span key={p.area}
                      title={`${nombreArea(p.area)}${p.incompleta ? ' — falta la nota de algún período; la final puede cambiar' : ''}`}
                      className={`text-xs rounded-md border pl-2 pr-1 py-0.5 flex items-center gap-1 ${p.incompleta ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
                      {nombreArea(p.area)} <b>{fmt(p.nota)}</b>{p.incompleta && ' *'}
                      {etapa !== 'RESULTADOS' && corte === 'FINAL' && (
                        <button onClick={() => ajustarArea(f, p.area, cfg.notaMinima)}
                          title={`Ayudar: subir ${nombreArea(p.area)} a ${cfg.notaMinima.toFixed(1)}. En pantalla queda marcado; en lo impreso sale como nota normal.`}
                          className="ml-0.5 rounded bg-white/80 border border-current px-1 text-[10px] font-bold hover:bg-violet-100 hover:text-violet-800">
                          ↑{cfg.notaMinima.toFixed(1)}
                        </button>
                      )}
                    </span>
                  ))}
                  {f.an.ajustadas.map(a => (
                    <span key={a.area}
                      title="Nota ajustada en preconsejo/comisión. Solo se ve aquí: en los listados impresos sale como la nota del área."
                      className="text-xs rounded-md border border-violet-300 bg-violet-50 text-violet-800 pl-2 pr-1 py-0.5 flex items-center gap-1">
                      ✎ {nombreArea(a.area)} {fmt(a.original)} → <b>{fmt(a.nota)}</b>
                      {etapa !== 'RESULTADOS' && (
                        <button onClick={() => ajustarArea(f, a.area, null)} title="Quitar el ajuste"
                          className="ml-0.5 rounded px-1 text-[10px] font-bold hover:bg-violet-200">✕</button>
                      )}
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
                {!f.guardada?.decision && <span className="text-[10px] text-slate-400">sugerida — aún sin confirmar</span>}
                {f.guardada?.decision && f.decision !== f.sugerida && (
                  <span className="text-[10px] text-violet-800 bg-violet-100 rounded px-1.5 py-0.5 flex items-center gap-1.5">
                    Decisión del consejo · la regla indicaba: <b>{labelDecision(f.sugerida)}</b>
                    <button
                      onClick={() => guardarDecision(corte, f.grupo.clave, f.est.nombre, { quitarDecision: true })}
                      className="underline text-violet-700 hover:text-violet-900">Volver a la sugerida</button>
                  </span>
                )}
                <ObservacionInput
                  valor={f.guardada?.observacion ?? ''}
                  onGuardar={v => guardarDecision(corte, f.grupo.clave, f.est.nombre, { observacion: v })} />
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
