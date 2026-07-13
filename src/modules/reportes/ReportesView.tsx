import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { cargarActividades, cargarFilasGrupo } from '../calificaciones/calificacionesService';
import type { Area, Asignatura, Grupo } from '@/db/types';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}

type TipoReporte = 'notas' | 'asistencia';

// ── CSS del reporte imprimible ──────────────────────────────
const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; padding: 12px; }
.header { text-align: center; border-bottom: 1.5px solid #333; padding-bottom: 8px; margin-bottom: 14px; }
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

function reportEncabezado(titulo: string, sub1: string, sub2 = ''): string {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div class="header">
      <h1>I.E. Rural Miguel Pinedo Barros</h1>
      <p class="sub">La Punta de los Remedios · Uribia, La Guajira · ${new Date().getFullYear()}</p>
      <h2>${titulo}</h2>
      <p class="sub">${sub1}${sub2 ? ' · ' + sub2 : ''}</p>
      <p class="sub">Fecha: ${hoy} · Docente: J. González</p>
    </div>
  `;
}

function abrirVentana(titulo: string, cuerpo: string): void {
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) {
    alert('Permita ventanas emergentes en su navegador para imprimir.');
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<title>${titulo}</title><style>${PRINT_CSS}</style></head>` +
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
  const matriculas = await db.matriculas
    .where('[grupo_id+anio]').equals([grupoId, anio]).toArray();

  const estudiantesRaw = await db.estudiantes.bulkGet(matriculas.map(m => m.estudiante_id));
  const estMap = new Map(
    estudiantesRaw.filter(Boolean).map(e => [e!.id, e!]),
  );

  const matriculaIds = new Set(matriculas.map(m => m.id));
  const todosRegistros = await db.registros_asistencia
    .where('asignatura_id').equals(asigId).toArray();
  const registros = todosRegistros.filter(r => matriculaIds.has(r.matricula_id));

  const conteo: Record<string, { asiste: number; fj: number; fi: number }> = {};
  for (const m of matriculas) conteo[m.id] = { asiste: 0, fj: 0, fi: 0 };
  for (const r of registros) {
    if (!conteo[r.matricula_id]) continue;
    if (r.estado === 'ASISTE') conteo[r.matricula_id].asiste++;
    else if (r.estado === 'FJ')    conteo[r.matricula_id].fj++;
    else if (r.estado === 'FI')    conteo[r.matricula_id].fi++;
  }

  const filas = matriculas
    .map(m => {
      const est = estMap.get(m.estudiante_id);
      if (!est) return null;
      const nombre = [est.apellido1, est.apellido2, est.nombre1, est.nombre2].filter(Boolean).join(' ');
      const { asiste, fj, fi } = conteo[m.id] ?? { asiste: 0, fj: 0, fi: 0 };
      const total = asiste + fj + fi;
      const pct   = total > 0 ? Math.round((asiste / total) * 100) : 100;
      return { nombre, asiste, fj, fi, total, pct };
    })
    .filter(Boolean)
    .sort((a, b) => a!.nombre.localeCompare(b!.nombre, 'es'));

  const tbody = filas.map((f, i) => {
    const cls = f!.pct < 80 ? 'rojo' : 'verde';
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="nombre">${f!.nombre}</td>
      <td class="c">${f!.asiste}</td>
      <td class="c">${f!.fj}</td>
      <td class="c">${f!.fi}</td>
      <td class="c">${f!.total}</td>
      <td class="final ${cls}">${f!.pct}%</td>
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

// ── Componente principal ────────────────────────────────────

export function ReportesView() {
  const anio = new Date().getFullYear();

  const [grupoId,   setGrupoId]   = useState('');
  const [asigId,    setAsigId]    = useState('');
  const [periodo,   setPeriodo]   = useState(1);
  const [tipo,      setTipo]      = useState<TipoReporte>('notas');
  const [generando, setGenerando] = useState(false);

  const grupos     = useLiveQuery<Grupo[]>(     () => db.grupos.where('anio').equals(anio).toArray(), [anio]);
  const todasAsigs = useLiveQuery<Asignatura[]>(() => db.asignaturas.toArray(), []);
  const areas      = useLiveQuery<Area[]>(      () => db.areas.toArray(),       []);

  const asignaturasGrupo = useLiveQuery<Asignatura[]>(async () => {
    if (!todasAsigs || !grupoId) return [];
    const ga = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (ga.length === 0) return todasAsigs;
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

  return (
    <div className="flex flex-col h-full">
      {/* Selectores */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
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

        {/* Tipo + período */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['notas', 'asistencia'] as TipoReporte[]).map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors
                  ${tipo === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {t === 'notas' ? '✎ Notas' : '✓ Asistencia'}
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
    </div>
  );
}
