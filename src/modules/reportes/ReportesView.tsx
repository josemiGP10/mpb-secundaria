import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSupaQuery } from '@/db/useSupaQuery';
import { getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';
import { cargarActividades, cargarFilasGrupo } from '../calificaciones/calificacionesService';
import { generarDistribucionSalones, type Salones } from './salonesService';
import type { Area, Asignatura, Grupo } from '@/db/types';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}

type TipoReporte = 'notas' | 'asistencia' | 'salones';

// ── CSS del reporte imprimible ──────────────────────────────
const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; padding: 12px; }
.header { text-align: center; border-bottom: 1.5px solid #333; padding-bottom: 8px; margin-bottom: 14px; }
.header-row { display: flex; align-items: center; justify-content: center; gap: 10px; }
.header-row .logo { height: 40px; width: auto; flex-shrink: 0; }
.header h1 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
.header h2 { font-size: 11px; margin-top: 5px; }
.sub { font-size: 9px; color: #666; margin-top: 3px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { background: #e0e0e0; font-weight: bold; font-size: 9px; text-transform: uppercase; }
td, th { border: 0.5px solid #aaa; padding: 3px 5px; vertical-align: middle; }
.c { text-align: center; }
.num { width: 22px; text-align: center; color: #666; }
.nombre { min-width: 130px; }
.nota { width: 36px; text-align: center; }
.final { width: 40px; text-align: center; font-weight: bold; }
.desemp { width: 55px; text-align: center; }
.verde { color: #166534; }
.rojo  { color: #991b1b; }
.footer { margin-top: 14px; font-size: 9px; color: #888; display: flex; justify-content: space-between; }
.firma { margin-top: 36px; border-top: 0.5px solid #aaa; width: 180px; text-align: center; padding-top: 4px; font-size: 9px; color: #555; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

// ── CSS del listado de salones — para pegar en cartelera ────
// Letra grande y a dos columnas: se lee de pie, no en un escritorio.
const SALON_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 18px 28px; }
.salon-page { page-break-after: always; }
.header { text-align: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 9px; margin-bottom: 13px; }
.header-row { display: flex; align-items: center; justify-content: center; gap: 12px; }
.header-row .logo { height: 52px; width: auto; flex-shrink: 0; }
.header h1 { font-size: 17px; text-transform: uppercase; letter-spacing: 0.5px; color: #333; }
.header .sub { font-size: 11px; color: #666; margin-top: 2px; }
.salon-titulo { font-size: 40px; font-weight: 900; color: #1e3a8a; margin: 6px 0 1px; letter-spacing: 1px; line-height: 1; }
.salon-examen { font-size: 17px; font-weight: 600; color: #333; margin-top: 2px; }
.lista { column-count: 2; column-gap: 28px; }
.item { break-inside: avoid; display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #ddd; }
.item .num { font-size: 14px; font-weight: 700; color: #94a3b8; width: 24px; flex-shrink: 0; }
.item .nombre { font-size: 17px; font-weight: 600; flex: 1; line-height: 1.1; }
.item .grado { font-size: 13px; font-weight: 700; color: #1e3a8a; background: #dbeafe; padding: 2px 8px; border-radius: 7px; flex-shrink: 0; white-space: nowrap; }
.salon-footer { margin-top: 11px; font-size: 11px; color: #888; text-align: center; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const LOGO_URL = `${window.location.origin}/logo-iermpb.jpg`;
const UBICACION = 'La Punta de los Remedios, Dibulla - La Guajira';

function reportEncabezado(titulo: string, sub1: string, sub2 = ''): string {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div class="header">
      <div class="header-row">
        <img class="logo" src="${LOGO_URL}" alt="" />
        <div>
          <h1>I.E. Rural Miguel Pinedo Barros</h1>
          <p class="sub">${UBICACION} · ${new Date().getFullYear()}</p>
        </div>
      </div>
      <h2>${titulo}</h2>
      <p class="sub">${sub1}${sub2 ? ' · ' + sub2 : ''}</p>
      <p class="sub">Fecha: ${hoy} · Docente: J. González</p>
    </div>
  `;
}

function abrirVentana(titulo: string, cuerpo: string, css: string = PRINT_CSS): void {
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) {
    alert('Permita ventanas emergentes en su navegador para imprimir.');
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<title>${titulo}</title><style>${css}</style></head>` +
    `<body>${cuerpo}</body></html>`,
  );
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function desempeno(nota: number | undefined): string {
  if (nota === undefined) return '—';
  if (nota >= 9.0) return 'Superior';
  if (nota >= 7.5) return 'Alto';
  if (nota >= 6.0) return 'Básico';
  return 'Bajo';
}

// ── Generadores de HTML ──────────────────────────────────────

async function imprimirNotas(
  grupoId: string, asigId: string, periodo: number, anio: number,
  grupoNombre: string, asigNombre: string,
  tipoArea: 'BASICA' | 'COMPLEMENTARIA',
  labelPeriodo: string,
): Promise<void> {
  const [actividades, filas] = await Promise.all([
    cargarActividades(grupoId, asigId, periodo, anio),
    cargarFilasGrupo(grupoId, asigId, periodo, anio),
  ]);

  const esBasica = tipoArea === 'BASICA';

  const actCols = actividades.map(a =>
    `<th class="nota">${a.nombre}</th>`,
  ).join('');

  const thead = `<tr>
    <th class="num">Nº</th>
    <th class="nombre">Estudiante</th>
    ${actCols}
    <th class="nota">Cog.</th>
    ${esBasica ? '<th class="nota">Prueba</th>' : ''}
    <th class="nota">Social</th>
    <th class="nota">Personal</th>
    <th class="final">Final</th>
    <th class="desemp">Desempeño</th>
  </tr>`;

  const tbody = filas.map((fila, idx) => {
    const notas = actividades.map(a => {
      const v = fila.notasPorActividad[a.id]?.valor;
      return `<td class="nota">${v !== undefined ? v.toFixed(1) : ''}</td>`;
    }).join('');

    const vals = actividades
      .map(a => fila.notasPorActividad[a.id]?.valor)
      .filter((v): v is number => v !== undefined);
    const cogProm = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : undefined;
    const final  = fila.nota_final;
    const cls    = final !== undefined && final < 6 ? 'rojo' : 'verde';

    return `<tr>
      <td class="num">${idx + 1}</td>
      <td class="nombre">${fila.nombreCompleto}</td>
      ${notas}
      <td class="nota">${cogProm !== undefined ? cogProm.toFixed(1) : ''}</td>
      ${esBasica ? `<td class="nota">${fila.prueba_institucional !== undefined ? fila.prueba_institucional.toFixed(1) : ''}</td>` : ''}
      <td class="nota">${fila.nota_social.toFixed(1)}</td>
      <td class="nota">${fila.nota_personal.toFixed(1)}</td>
      <td class="final ${cls}">${final !== undefined ? final.toFixed(1) : '—'}</td>
      <td class="desemp">${desempeno(final)}</td>
    </tr>`;
  }).join('');

  const aprobados = filas.filter(f => (f.nota_final ?? 0) >= 6).length;

  const cuerpo =
    reportEncabezado(
      `Reporte de Notas — Grupo ${grupoNombre}`,
      `Asignatura: ${asigNombre}`,
      labelPeriodo,
    ) +
    `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>` +
    `<div class="footer">
      <span>Total: ${filas.length} estudiantes · Aprobados: ${aprobados} · Reprobados: ${filas.length - aprobados}</span>
      <span>Escala 1.0 – 10.0 · Aprobación ≥ 6.0</span>
    </div>
    <div class="firma">J. González · Docente</div>`;

  abrirVentana(`Notas ${grupoNombre} ${asigNombre} ${labelPeriodo}`, cuerpo);
}

async function imprimirAsistencia(
  grupoId: string, asigId: string, anio: number,
  grupoNombre: string, asigNombre: string,
): Promise<void> {
  const [paresActivos, paresRetirados] = await Promise.all([
    getEstudiantesPorGrupo(grupoId, anio),
    getEstudiantesRetiradosPorGrupo(grupoId, anio),
  ]);
  // Mismo criterio que Asistencia/Notas/Salones: si hay matrículas duplicadas
  // (siembra multi-dispositivo), un mismo estudiante puede aparecer como
  // activo Y retirado — la versión retirada tiene precedencia y se excluye.
  const retiradosKeys = new Set(
    paresRetirados.map(p => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
  );
  const pares = paresActivos.filter(
    p => !retiradosKeys.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
  );

  const matriculaIds = new Set(pares.map(p => p.matricula.id));
  if (!supabase) throw new Error('Supabase no configurado.');
  const { data: todosRegistros, error } = await supabase
    .from('registros_asistencia').select('*').eq('asignatura_id', asigId);
  if (error) throw new Error(error.message);
  const registros = (todosRegistros ?? []).filter(r => matriculaIds.has(r.matricula_id));

  const conteo: Record<string, { asiste: number; fj: number; fi: number }> = {};
  for (const p of pares) conteo[p.matricula.id] = { asiste: 0, fj: 0, fi: 0 };
  for (const r of registros) {
    if (!conteo[r.matricula_id]) continue;
    if (r.estado === 'ASISTE') conteo[r.matricula_id].asiste++;
    else if (r.estado === 'FJ')    conteo[r.matricula_id].fj++;
    else if (r.estado === 'FI')    conteo[r.matricula_id].fi++;
  }

  const filas = pares
    .map(({ matricula, estudiante }) => {
      const nombre = [estudiante.apellido1, estudiante.apellido2, estudiante.nombre1, estudiante.nombre2].filter(Boolean).join(' ');
      const { asiste, fj, fi } = conteo[matricula.id] ?? { asiste: 0, fj: 0, fi: 0 };
      const total = asiste + fj + fi;
      const pct   = total > 0 ? Math.round((asiste / total) * 100) : 100;
      return { nombre, asiste, fj, fi, total, pct };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const tbody = filas.map((f, i) => {
    const cls = f.pct < 80 ? 'rojo' : 'verde';
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="nombre">${f.nombre}</td>
      <td class="c">${f.asiste}</td>
      <td class="c">${f.fj}</td>
      <td class="c">${f.fi}</td>
      <td class="c">${f.total}</td>
      <td class="final ${cls}">${f.pct}%</td>
    </tr>`;
  }).join('');

  const cuerpo =
    reportEncabezado(
      `Reporte de Asistencia — Grupo ${grupoNombre}`,
      `Asignatura: ${asigNombre}`,
      `Año ${anio}`,
    ) +
    `<table>
      <thead><tr>
        <th class="num">Nº</th>
        <th class="nombre">Estudiante</th>
        <th class="c">Asiste</th>
        <th class="c">F.J.</th>
        <th class="c">F.I.</th>
        <th class="c">Total</th>
        <th class="final">%</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>` +
    `<div class="footer">
      <span>Total: ${filas.length} estudiantes</span>
      <span>Asistencia mínima requerida: 80%</span>
    </div>
    <div class="firma">J. González · Docente</div>`;

  abrirVentana(`Asistencia ${grupoNombre} ${asigNombre}`, cuerpo);
}

function imprimirSalones(salones: Salones, tituloExamen: string, anio: number): void {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });

  const bloques = salones.map((estudiantes, idx) => {
    const items = estudiantes.map((e, i) => `
      <div class="item">
        <span class="num">${i + 1}.</span>
        <span class="nombre">${e.nombreCompleto}</span>
        <span class="grado">${e.grupoNombre}</span>
      </div>`).join('');

    return `
      <div class="salon-page">
        <div class="header">
          <div class="header-row">
            <img class="logo" src="${LOGO_URL}" alt="" />
            <div>
              <h1>I.E. Rural Miguel Pinedo Barros</h1>
              <p class="sub">${UBICACION} · ${anio}</p>
            </div>
          </div>
          <div class="salon-titulo">SALÓN ${idx + 1}</div>
          <p class="salon-examen">${tituloExamen}</p>
          <p class="sub">Fecha: ${hoy}</p>
        </div>
        <div class="lista">${items}</div>
        <div class="salon-footer">
          Total: ${estudiantes.length} estudiantes · Salón ${idx + 1} de ${salones.length}
        </div>
      </div>`;
  }).join('');

  abrirVentana(`Distribución ${tituloExamen}`, bloques, SALON_CSS);
}

// ── Componente principal ────────────────────────────────────

export function ReportesView() {
  const anio = new Date().getFullYear();

  const [grupoId,   setGrupoId]   = useState('');
  const [asigId,    setAsigId]    = useState('');
  const [periodo,   setPeriodo]   = useState(1);
  const [tipo,      setTipo]      = useState<TipoReporte>('notas');
  const [generando, setGenerando] = useState(false);

  // ── Distribución de salones (Prueba Institucional) ────────
  const [numSalones,       setNumSalones]       = useState(15);
  const [tituloExamen,     setTituloExamen]      = useState('Prueba Institucional');
  const [salonesPreview,   setSalonesPreview]    = useState<Salones | null>(null);
  const [generandoSalones, setGenerandoSalones]  = useState(false);

  const grupos = useSupaQuery<Grupo[]>(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('grupos').select('*').eq('anio', anio);
    if (error) throw new Error(error.message);
    return data ?? [];
  }, [anio]);
  const todasAsigs = useSupaQuery<Asignatura[]>(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('asignaturas').select('*');
    if (error) throw new Error(error.message);
    return data ?? [];
  }, []);
  const areas = useSupaQuery<Area[]>(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('areas').select('*');
    if (error) throw new Error(error.message);
    return data ?? [];
  }, []);

  const asignaturasGrupo = useSupaQuery<Asignatura[]>(async () => {
    if (!supabase || !todasAsigs || !grupoId) return [];
    const { data: ga, error } = await supabase.from('grupo_asignaturas').select('*').eq('grupo_id', grupoId);
    if (error) throw new Error(error.message);
    if (!ga || ga.length === 0) return todasAsigs;
    const ids = new Set(ga.map(x => x.asignatura_id));
    return todasAsigs.filter(a => ids.has(a.id));
  }, [grupoId, todasAsigs]) ?? [];

  const grupoSelec  = grupos?.find(g => g.id === grupoId);
  const asigSelec   = asignaturasGrupo.find(a => a.id === asigId);
  const areaSelec   = areas?.find(a => a.id === asigSelec?.area_id);
  const tipoArea    = (areaSelec?.tipo ?? 'COMPLEMENTARIA') as 'BASICA' | 'COMPLEMENTARIA';
  const numPeriodos = grupoSelec?.num_periodos ?? 4;
  const labelPer    = numPeriodos === 2 ? 'Semestre' : 'Período';
  const canPrint    = !!grupoId && !!asigId;

  const handleImprimir = async () => {
    if (!canPrint || generando) return;
    setGenerando(true);
    try {
      if (tipo === 'notas') {
        await imprimirNotas(
          grupoId, asigId, periodo, anio,
          grupoSelec?.nombre ?? '', asigSelec?.nombre ?? '',
          tipoArea, `${labelPer} ${periodo}`,
        );
      } else {
        await imprimirAsistencia(
          grupoId, asigId, anio,
          grupoSelec?.nombre ?? '', asigSelec?.nombre ?? '',
        );
      }
    } catch (e) {
      console.error(e);
      alert('Error generando el reporte. Intente de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  const handleGenerarSalones = async () => {
    if (generandoSalones || numSalones < 1) return;
    setGenerandoSalones(true);
    try {
      setSalonesPreview(await generarDistribucionSalones(anio, numSalones));
    } catch (e) {
      console.error(e);
      alert('Error generando la distribución. Intente de nuevo.');
    } finally {
      setGenerandoSalones(false);
    }
  };

  const handleImprimirSalones = () => {
    if (!salonesPreview) return;
    imprimirSalones(salonesPreview, tituloExamen.trim() || 'Prueba Institucional', anio);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Selectores */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        {tipo !== 'salones' ? (
          <div className="flex gap-1.5">
            <select
              value={grupoId}
              onChange={e => { setGrupoId(e.target.value); setAsigId(''); setPeriodo(1); }}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="">— Grupo —</option>
              {sortGrupos(grupos ?? []).map(g => (
                <option key={g.id} value={g.id}>{g.nombre}</option>
              ))}
            </select>
            <select
              value={asigId}
              onChange={e => setAsigId(e.target.value)}
              disabled={!grupoId}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-40"
            >
              <option value="">— Asignatura —</option>
              {asignaturasGrupo.map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={tituloExamen}
              onChange={e => { setTituloExamen(e.target.value); setSalonesPreview(null); }}
              placeholder="Título del examen"
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              min={1}
              max={50}
              value={numSalones}
              onChange={e => { setNumSalones(Math.max(1, Number(e.target.value) || 1)); setSalonesPreview(null); }}
              title="Número de salones"
              className="w-16 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Tipo + período */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['notas', 'asistencia', 'salones'] as TipoReporte[]).map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors
                  ${tipo === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {t === 'notas' ? '✎ Notas' : t === 'asistencia' ? '✓ Asistencia' : '🎲 Salones'}
              </button>
            ))}
          </div>

          {tipo === 'notas' && grupoId && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">{labelPer}:</span>
              {Array.from({ length: numPeriodos }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriodo(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors
                    ${periodo === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cuerpo */}
      {tipo !== 'salones' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center">
          <div className="text-5xl select-none">🖨</div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">
              {tipo === 'notas' ? 'Boletín de Notas' : 'Reporte de Asistencia'}
            </h2>
            <p className="text-sm text-slate-500 max-w-xs">
              {tipo === 'notas'
                ? 'Abre una ventana con la tabla de calificaciones lista para imprimir o guardar como PDF.'
                : 'Abre una ventana con el resumen de asistencia por estudiante listo para imprimir.'}
            </p>
          </div>

          {canPrint && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-3 text-left text-sm text-slate-700 space-y-1 w-full max-w-xs">
              <p>
                <span className="text-slate-400 text-xs block">Grupo</span>
                <strong>{grupoSelec?.nombre}</strong>
              </p>
              <p>
                <span className="text-slate-400 text-xs block">Asignatura</span>
                <strong>{asigSelec?.nombre}</strong>
              </p>
              {tipo === 'notas' && (
                <p>
                  <span className="text-slate-400 text-xs block">{labelPer}</span>
                  <strong>{periodo}</strong>
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleImprimir}
            disabled={!canPrint || generando}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generando ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Generando...
              </>
            ) : (
              <><span>🖨</span> Imprimir / Guardar PDF</>
            )}
          </button>

          {!canPrint && (
            <p className="text-xs text-slate-400">Seleccione grupo y asignatura para continuar</p>
          )}

          <p className="text-[10px] text-slate-300 max-w-xs">
            Se abrirá una nueva ventana. En el diálogo de impresión puede elegir "Guardar como PDF" para exportar el archivo.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center overflow-y-auto">
          <div className="text-5xl select-none">🎲</div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Distribución para Prueba Institucional</h2>
            <p className="text-sm text-slate-500 max-w-xs">
              Mezcla los estudiantes activos de toda la secundaria (incluidos los MEF) en {numSalones} salones,
              repartiendo cada curso entre todos para reducir el riesgo de copia. Los retirados no se incluyen.
            </p>
          </div>

          <button
            onClick={handleGenerarSalones}
            disabled={generandoSalones}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generandoSalones ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Mezclando...
              </>
            ) : (
              <><span>🎲</span> {salonesPreview ? 'Volver a mezclar' : 'Generar distribución'}</>
            )}
          </button>

          {salonesPreview && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-left text-xs text-slate-700 w-full max-w-sm">
                <p className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mb-2">
                  Vista previa · {salonesPreview.reduce((s, sal) => s + sal.length, 0)} estudiantes
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {salonesPreview.map((sal, i) => (
                    <div key={i} className="rounded-lg bg-white border border-slate-200 px-2 py-1.5 text-center">
                      <p className="text-slate-400 text-[9px]">Salón {i + 1}</p>
                      <p className="font-bold text-slate-800">{sal.length}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleImprimirSalones}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-semibold text-sm shadow hover:bg-emerald-700 active:scale-95 transition-all"
              >
                <span>🖨</span> Imprimir / Guardar PDF
              </button>
            </>
          )}

          <p className="text-[10px] text-slate-300 max-w-xs">
            Se abrirá una nueva ventana con un salón por página. En el diálogo de impresión puede elegir "Guardar como PDF".
          </p>
        </div>
      )}
    </div>
  );
}
