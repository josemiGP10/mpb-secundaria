import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import {
  getEstudiantesRetiradosPorGrupo,
  getEstudiantesPorGrupo,
  retirarEstudiante,
  reactivarEstudiante,
  moverEstudianteAGrupo,
  agregarEstudianteNuevo,
} from '@/db/database';
import type { EstadoAsistencia, Grupo, Matricula, Estudiante } from '@/db/types';
import {
  cargarAsistenciaGrupo,
  cargarAsistenciaMes,
  setEstadoDirecto,
  toggleEstadoFecha,
  tomarListaCompleta,
  type FilaAsistencia,
  type FilaMes,
} from './asistenciaService';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}

// ============================================================
//  PANTALLA: Asistencia
//  Vista Día  — 3 botones por estudiante (Asiste / FJ / FI)
//  Vista Mes  — grilla editable histórico
// ============================================================

function fechaLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const HOY       = fechaLocal();
const HOY_MES   = new Date().getMonth() + 1;
const HOY_ANIO  = new Date().getFullYear();

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

type Vista = 'dia' | 'mes';

export function AsistenciaView() {
  const anio = HOY_ANIO;

  const [vista,          setVista]          = useState<Vista>('dia');
  const [grupoId,        setGrupoId]        = useState('');
  const [asignaturaId,   setAsignaturaId]   = useState('');
  const [fecha,          setFecha]          = useState(HOY);
  const [mes,            setMes]            = useState(HOY_MES);
  const [modalGestionar, setModalGestionar] = useState(false);

  const grupos = useLiveQuery(async () => {
    return db.grupos.where('anio').equals(anio).toArray();
  }, [anio]);

  const asignaturas = useLiveQuery(async () => {
    if (!grupoId) return [];
    const links = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (links.length === 0) return db.asignaturas.toArray();
    const ids = [...new Set(links.map((l) => l.asignatura_id))];
    const all = (await db.asignaturas.bulkGet(ids)).filter((x): x is NonNullable<typeof x> => x != null);
    return all.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [grupoId, anio]);

  // ── Estado vista día ───────────────────────────────────
  const [filas,   setFilas]   = useState<FilaAsistencia[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Estado vista mes ───────────────────────────────────
  const [grilla,     setGrilla]     = useState<{ filas: FilaMes[]; fechas: string[] } | null>(null);
  const [loadingMes, setLoadingMes] = useState(false);

  const [busy, setBusy] = useState(false);

  // ── Carga día ──────────────────────────────────────────
  useEffect(() => {
    if (vista !== 'dia' || !grupoId || !asignaturaId) { setFilas([]); return; }
    setLoading(true);
    cargarAsistenciaGrupo(grupoId, anio, asignaturaId, fecha)
      .then(setFilas)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [vista, grupoId, asignaturaId, fecha, anio]);

  // ── Carga mes ──────────────────────────────────────────
  useEffect(() => {
    if (vista !== 'mes' || !grupoId || !asignaturaId) { setGrilla(null); return; }
    setLoadingMes(true);
    cargarAsistenciaMes(grupoId, anio, asignaturaId, mes)
      .then(setGrilla)
      .catch(console.error)
      .finally(() => setLoadingMes(false));
  }, [vista, grupoId, asignaturaId, mes, anio]);

  // ── Set estado directo (3 botones) ─────────────────────
  const handleSetEstadoDia = async (fila: FilaAsistencia, estado: EstadoAsistencia) => {
    if (busy) return;
    setBusy(true);
    try {
      const actualizado = await setEstadoDirecto(fila, asignaturaId, fecha, estado);
      setFilas((prev) =>
        prev.map((f) => f.matriculaId === fila.matriculaId ? { ...f, ...actualizado } : f),
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Toggle vista mes ───────────────────────────────────
  const handleToggleMes = async (
    matriculaId: string,
    fechaCelda:  string,
    estadoActual: EstadoAsistencia | null,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const nuevo = await toggleEstadoFecha(matriculaId, asignaturaId, fechaCelda, estadoActual);
      setGrilla((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          filas: prev.filas.map((f) => {
            if (f.matriculaId !== matriculaId) return f;
            const est = new Map(f.estados);
            if (nuevo === null) est.delete(fechaCelda);
            else                est.set(fechaCelda, nuevo);
            return { ...f, estados: est };
          }),
        };
      });
    } finally {
      setBusy(false);
    }
  };

  // ── Tomar lista completa ───────────────────────────────
  const handleTomarLista = async () => {
    if (busy || filas.length === 0) return;
    setBusy(true);
    try {
      setFilas(await tomarListaCompleta(filas, asignaturaId, fecha));
    } finally {
      setBusy(false);
    }
  };

  // ── Recargar lista tras cambios en el modal ────────────
  const recargarDia = () => {
    if (!grupoId || !asignaturaId) return;
    setLoading(true);
    cargarAsistenciaGrupo(grupoId, anio, asignaturaId, fecha)
      .then(setFilas)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  // ── Render ─────────────────────────────────────────────
  if (!grupos || !asignaturas) return <CenteredMsg>Cargando...</CenteredMsg>;
  if (grupos.length === 0) {
    return <CenteredMsg>No hay grupos registrados. Verifique la base de datos.</CenteredMsg>;
  }

  const filasActivas   = filas.filter((f) => !f.retirado);
  const sinRegistroHoy = filasActivas.filter((f) => f.estadoHoy === null).length;
  const listaTomada    = filasActivas.length > 0 && sinRegistroHoy === 0;

  return (
    <div className="flex flex-col h-full">

      {/* ── Barra de selectores ── */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        {/* Fila 1: grupo + asignatura + gestionar */}
        <div className="flex gap-1.5">
          <select
            value={grupoId}
            onChange={(e) => { setGrupoId(e.target.value); setAsignaturaId(''); setModalGestionar(false); }}
            className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="">— Grupo —</option>
            {sortGrupos(grupos ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.nombre}</option>
            ))}
          </select>
          <select
            value={asignaturaId}
            onChange={(e) => setAsignaturaId(e.target.value)}
            disabled={!grupoId}
            className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-40"
          >
            <option value="">— Asignatura —</option>
            {(asignaturas ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
          <button
            onClick={() => setModalGestionar(true)}
            disabled={!grupoId}
            title="Gestionar estudiantes del grupo"
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-300 text-base leading-none text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
          >
            👥
          </button>
        </div>
        {/* Fila 2: vista + fecha/mes + tomar lista */}
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg overflow-hidden border border-slate-300 flex-shrink-0">
            <VistaBtn active={vista === 'dia'} onClick={() => setVista('dia')}>Día</VistaBtn>
            <VistaBtn active={vista === 'mes'} onClick={() => setVista('mes')}>Mes</VistaBtn>
          </div>
          {vista === 'dia' ? (
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            />
          ) : (
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {MESES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
          {vista === 'dia' && grupoId && asignaturaId && filas.length > 0 && (
            <button
              onClick={handleTomarLista}
              disabled={busy || listaTomada}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${listaTomada
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                  : 'bg-emerald-700 text-white active:scale-95 disabled:opacity-50'
                }`}
            >
              {listaTomada ? '✓ Lista' : `Lista (${sinRegistroHoy})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Barra de estadísticas (vista día) ── */}
      {vista === 'dia' && grupoId && asignaturaId && filas.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 bg-slate-100 border-b border-surface-muted flex-shrink-0">
          <StatChip label="Total"        value={filasActivas.length}                                           color="slate"   />
          <StatChip label="Asisten"      value={filasActivas.filter((f) => f.estadoHoy === 'ASISTE').length} color="emerald" />
          <StatChip label="F.J."         value={filasActivas.filter((f) => f.estadoHoy === 'FJ').length}     color="yellow"  />
          <StatChip label="F.I."         value={filasActivas.filter((f) => f.estadoHoy === 'FI').length}     color="red"     />
          <StatChip label="Sin registro" value={sinRegistroHoy}                                              color="slate"   />
        </div>
      )}

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-auto">
        {!grupoId && <CenteredMsg dimmer>Seleccione un grupo.</CenteredMsg>}
        {grupoId && !asignaturaId && <CenteredMsg dimmer>Seleccione una asignatura.</CenteredMsg>}

        {/* Vista Día */}
        {vista === 'dia' && grupoId && asignaturaId && (
          <>
            {loading && <CenteredMsg>Cargando...</CenteredMsg>}
            {!loading && filas.length === 0 && <CenteredMsg>No hay estudiantes en este grupo.</CenteredMsg>}
            {!loading && filas.length > 0 && (
              <DayTable filas={filas} busy={busy} onSetEstado={handleSetEstadoDia} />
            )}
          </>
        )}

        {/* Vista Mes */}
        {vista === 'mes' && grupoId && asignaturaId && (
          <>
            {loadingMes && <CenteredMsg>Cargando grilla...</CenteredMsg>}
            {!loadingMes && (!grilla || grilla.fechas.length === 0) && (
              <CenteredMsg>
                Sin sesiones registradas en {MESES[mes - 1]}.{'\n'}
                Use la vista Día para registrar asistencia.
              </CenteredMsg>
            )}
            {!loadingMes && grilla && grilla.fechas.length > 0 && (
              <MesGrid grilla={grilla} busy={busy} onToggle={handleToggleMes} />
            )}
          </>
        )}
      </div>

      {/* ── Modal gestión de estudiantes ── */}
      {modalGestionar && grupoId && grupos && (
        <GestionarEstudiantesModal
          grupoId={grupoId}
          grupoNombre={grupos.find(g => g.id === grupoId)?.nombre ?? ''}
          anio={anio}
          grupos={sortGrupos(grupos)}
          onClose={() => setModalGestionar(false)}
          onCambio={recargarDia}
        />
      )}
    </div>
  );
}

// ── DayTable ───────────────────────────────────────────────

function DayTable({
  filas, busy, onSetEstado,
}: {
  filas: FilaAsistencia[];
  busy: boolean;
  onSetEstado: (f: FilaAsistencia, estado: EstadoAsistencia) => void;
}) {
  const activos   = filas.filter(f => !f.retirado);
  const retirados = filas.filter(f => f.retirado);
  const registrados = activos.filter(f => f.estadoHoy !== null).length;

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10 bg-surface-card">
        <tr>
          <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted">
            Estudiante
          </th>
          <th className="text-center px-2 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted w-36">
            <span className="hidden sm:inline">Asiste · FJ · FI</span>
            <span className="sm:hidden">A · FJ · FI</span>
          </th>
          <th className="text-center px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted">
            Histórico
          </th>
        </tr>
      </thead>
      <tbody>
        {activos.map((fila, i) => (
          <DayRow
            key={fila.matriculaId}
            fila={fila}
            idx={i}
            busy={busy}
            onSetEstado={(estado) => onSetEstado(fila, estado)}
          />
        ))}

        {retirados.length > 0 && (
          <>
            <tr>
              <td colSpan={3} className="px-4 py-1.5 bg-slate-100 border-y border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Retirados ({retirados.length}) — solo lectura
                </span>
              </td>
            </tr>
            {retirados.map((fila, i) => (
              <DayRow
                key={fila.matriculaId}
                fila={fila}
                idx={i}
                busy={busy}
                onSetEstado={() => {}}
              />
            ))}
          </>
        )}
      </tbody>
      <tfoot className="sticky bottom-0 bg-surface-card border-t-2 border-surface-muted">
        <tr>
          <td colSpan={3} className="px-4 py-2 text-xs text-slate-500">
            {activos.length} activos · {registrados} con registro hoy
            {retirados.length > 0 && <span className="ml-2 text-slate-400">· {retirados.length} retirados</span>}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function nombreCorto(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(' ');
  if (partes.length <= 1) return nombreCompleto;
  const apellidos = partes.slice(0, Math.min(2, partes.length - 1)).join(' ');
  const inicialNombre = partes[partes.length - 1]?.[0] ?? '';
  return `${apellidos} ${inicialNombre}.`;
}

function DayRow({ fila, idx, busy, onSetEstado }: {
  fila: FilaAsistencia; idx: number; busy: boolean;
  onSetEstado: (estado: EstadoAsistencia) => void;
}) {
  const pct = fila.totalSesiones > 0
    ? Math.round((fila.asistidas / fila.totalSesiones) * 100)
    : null;

  if (fila.retirado) {
    return (
      <tr className="border-b border-slate-100 bg-slate-50/70 opacity-60">
        <td className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-xs leading-tight border-r border-slate-200/50">
          <span className="text-slate-500 italic">
            <span className="sm:hidden">{nombreCorto(fila.nombreCompleto)}</span>
            <span className="hidden sm:inline">{fila.nombreCompleto}</span>
          </span>
          {fila.retiroObs && (
            <p className="text-[9px] text-slate-400 mt-0.5 not-italic">{fila.retiroObs}</p>
          )}
        </td>
        <td className="text-center px-2 py-2">
          <span className="text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md">
            RETIRADO
          </span>
        </td>
        <td className="text-center px-3 py-2">
          {fila.totalSesiones === 0 ? (
            <span className="text-xs text-slate-400">—</span>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[11px] font-bold text-slate-400">
                {fila.asistidas}/{fila.totalSesiones}
                {pct !== null && <span className="font-normal"> ({pct}%)</span>}
              </span>
              {(fila.fj > 0 || fila.fi > 0) && (
                <div className="flex gap-1.5 text-[10px] text-slate-400">
                  {fila.fj > 0 && <span>{fila.fj}FJ</span>}
                  {fila.fi > 0 && <span>{fila.fi}FI</span>}
                </div>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b border-surface-muted/50 ${idx % 2 !== 0 ? 'bg-slate-50' : ''}`}>
      <td className={`sticky left-0 z-10 px-2 py-2.5 text-xs leading-tight border-r border-surface-muted/20 ${idx % 2 !== 0 ? 'bg-slate-50' : 'bg-white'}`}>
        <span className="sm:hidden text-slate-900">{nombreCorto(fila.nombreCompleto)}</span>
        <span className="hidden sm:inline text-slate-900">{fila.nombreCompleto}</span>
      </td>
      <td className="text-center px-1 py-1.5">
        <EstadoBtns estado={fila.estadoHoy} disabled={busy} onChange={onSetEstado} />
      </td>
      <td className="text-center px-3 py-2">
        {fila.totalSesiones === 0 ? (
          <span className="text-xs text-slate-700">—</span>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className={`text-[11px] font-bold ${pct !== null && pct < 75 ? 'text-red-600' : 'text-emerald-600'}`}>
              {fila.asistidas}/{fila.totalSesiones}
              {pct !== null && <span className="font-normal text-slate-500"> ({pct}%)</span>}
            </span>
            {(fila.fj > 0 || fila.fi > 0) && (
              <div className="flex gap-1.5 text-[10px]">
                {fila.fj > 0 && <span className="text-yellow-600">{fila.fj}FJ</span>}
                {fila.fi > 0 && <span className="text-red-600">{fila.fi}FI</span>}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── MesGrid ────────────────────────────────────────────────

function MesGrid({ grilla, busy, onToggle }: {
  grilla: { filas: FilaMes[]; fechas: string[] };
  busy: boolean;
  onToggle: (matriculaId: string, fecha: string, estado: EstadoAsistencia | null) => void;
}) {
  const { filas, fechas } = grilla;

  const fmtFecha = (f: string) => {
    const d = new Date(f + 'T00:00:00');
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  return (
    <div className="overflow-auto h-full">
      <table className="border-collapse text-xs min-w-max">
        <thead className="sticky top-0 z-10 bg-surface-card">
          <tr>
            <th className="sticky left-0 z-20 bg-surface-card text-left px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-r border-surface-muted min-w-[200px]">
              Estudiante
            </th>
            {fechas.map((f) => (
              <th key={f} className="text-center px-1 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted min-w-[44px]">
                {fmtFecha(f)}
              </th>
            ))}
            <th className="text-center px-3 py-2.5 text-xs text-slate-400 font-medium border-b border-l border-surface-muted min-w-[80px]">
              Resumen
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => {
            const vals      = [...fila.estados.values()];
            const asistidas = vals.filter((e) => e === 'ASISTE').length;
            const fj        = vals.filter((e) => e === 'FJ').length;
            const fi        = vals.filter((e) => e === 'FI').length;
            const total     = fila.estados.size;
            const pct       = total > 0 ? Math.round((asistidas / total) * 100) : null;
            const bgBase    = i % 2 !== 0 ? 'bg-slate-50' : 'bg-white';

            return (
              <tr key={fila.matriculaId} className={`border-b border-surface-muted/50 ${i % 2 !== 0 ? 'bg-slate-50' : ''}`}>
                <td className={`sticky left-0 z-10 ${bgBase} px-2 py-2 text-xs border-r border-surface-muted/30 min-w-[90px] sm:min-w-[160px]`}>
                  <span className="sm:hidden text-slate-900">{nombreCorto(fila.nombreCompleto)}</span>
                  <span className="hidden sm:inline text-slate-900 truncate block max-w-[155px]">{fila.nombreCompleto}</span>
                </td>
                {fechas.map((f) => {
                  const est = fila.estados.get(f) ?? null;
                  return (
                    <td key={f} className="text-center py-1 px-0.5">
                      <CeldaMes
                        estado={est}
                        disabled={busy}
                        onClick={() => onToggle(fila.matriculaId, f, est)}
                      />
                    </td>
                  );
                })}
                <td className="text-center px-2 py-1 border-l border-surface-muted/30">
                  {total === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`font-bold ${pct !== null && pct < 75 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {asistidas}/{total}
                      </span>
                      {(fj > 0 || fi > 0) && (
                        <div className="flex gap-1">
                          {fj > 0 && <span className="text-yellow-600">{fj}FJ</span>}
                          {fi > 0 && <span className="text-red-600">{fi}FI</span>}
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── EstadoBtns: 3 botones directos ────────────────────────

function EstadoBtns({ estado, disabled, onChange }: {
  estado: EstadoAsistencia | null;
  disabled: boolean;
  onChange: (e: EstadoAsistencia) => void;
}) {
  const btn = (e: EstadoAsistencia, label: string, activeClass: string) => (
    <button
      key={e}
      onClick={() => onChange(e)}
      disabled={disabled}
      title={estado === e ? 'Toque de nuevo para quitar el registro' : undefined}
      className={`
        w-9 h-8 rounded-lg border font-bold text-[11px] transition-all active:scale-95 disabled:opacity-50
        ${estado === e
          ? activeClass
          : 'bg-white text-slate-300 border-slate-300 hover:text-slate-500 hover:border-slate-400'
        }
      `}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-1 justify-center">
      {btn('ASISTE', '✓',  'bg-emerald-100 text-emerald-700 border-emerald-400')}
      {btn('FJ',     'FJ', 'bg-yellow-100 text-yellow-700 border-yellow-400')}
      {btn('FI',     '×',  'bg-red-100 text-red-700 border-red-400')}
    </div>
  );
}

// ── CeldaMes (vista mes — ciclo) ───────────────────────────

const CELDA_STYLES: Record<EstadoAsistencia, string> = {
  ASISTE: 'bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200',
  FJ:     'bg-yellow-100 border-yellow-300 text-yellow-700 hover:bg-yellow-200',
  FI:     'bg-red-100    border-red-300    text-red-700    hover:bg-red-200',
};
const CELDA_LABELS: Record<EstadoAsistencia, string> = {
  ASISTE: '✓', FJ: 'FJ', FI: 'FI',
};

function CeldaMes({ estado, disabled, onClick }: {
  estado: EstadoAsistencia | null; disabled: boolean; onClick: () => void;
}) {
  if (estado === null) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-9 h-7 rounded border border-dashed border-slate-300 hover:border-slate-400 text-slate-400 hover:text-slate-600 text-[10px] transition-colors disabled:opacity-50"
      >
        —
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={estado === 'FI' ? 'Toque de nuevo para borrar' : undefined}
      className={`w-9 h-7 rounded border font-bold text-[10px] transition-colors active:scale-95 disabled:opacity-50 ${CELDA_STYLES[estado]}`}
    >
      {CELDA_LABELS[estado]}
    </button>
  );
}

// ── GestionarEstudiantesModal ──────────────────────────────

type AccionEst =
  | { tipo: 'mover';   matriculaId: string; nombre: string }
  | { tipo: 'retirar'; matriculaId: string; nombre: string }
  | null;

const FORM_VACIO = {
  tipo_doc: 'T', doc: '', apellido1: '', apellido2: '',
  nombre1: '', nombre2: '', fecha_nacimiento: '',
};

function GestionarEstudiantesModal({
  grupoId, grupoNombre, anio, grupos, onClose, onCambio,
}: {
  grupoId:      string;
  grupoNombre:  string;
  anio:         number;
  grupos:       Grupo[];
  onClose:      () => void;
  onCambio:     () => void;
}) {
  const [activos,           setActivos]           = useState<{ matricula: Matricula; estudiante: Estudiante }[]>([]);
  const [retirados,         setRetirados]         = useState<{ matricula: Matricula; estudiante: Estudiante }[]>([]);
  const [accion,            setAccion]            = useState<AccionEst>(null);
  const [mostrarRetirados,  setMostrarRetirados]  = useState(false);
  const [mostrarFormNuevo,  setMostrarFormNuevo]  = useState(false);
  const [destGrupoId,       setDestGrupoId]       = useState('');
  const [retiroObs,         setRetiroObs]         = useState('');
  const [formNuevo,         setFormNuevo]         = useState({ ...FORM_VACIO });
  const [guardando,         setGuardando]         = useState(false);

  const cargar = async () => {
    const [a, r] = await Promise.all([
      getEstudiantesPorGrupo(grupoId, anio),
      getEstudiantesRetiradosPorGrupo(grupoId, anio),
    ]);
    setActivos(a);
    setRetirados(r);
  };

  useEffect(() => { cargar(); }, [grupoId, anio]);

  const wrap = async (fn: () => Promise<void>) => {
    if (guardando) return;
    setGuardando(true);
    try { await fn(); await cargar(); onCambio(); }
    catch (e) { alert('Error: ' + String(e)); }
    finally { setGuardando(false); }
  };

  const handleMover = () => wrap(async () => {
    if (!accion || accion.tipo !== 'mover' || !destGrupoId) return;
    await moverEstudianteAGrupo(accion.matriculaId, destGrupoId);
    setAccion(null);
    setDestGrupoId('');
  });

  const handleRetirar = () => wrap(async () => {
    if (!accion || accion.tipo !== 'retirar') return;
    await retirarEstudiante(accion.matriculaId, retiroObs);
    setAccion(null);
    setRetiroObs('');
  });

  const handleReactivar = (matriculaId: string) => wrap(async () => {
    await reactivarEstudiante(matriculaId);
  });

  const handleAgregar = () => wrap(async () => {
    if (!formNuevo.doc || !formNuevo.apellido1 || !formNuevo.nombre1) return;
    await agregarEstudianteNuevo(formNuevo, grupoId, anio);
    setMostrarFormNuevo(false);
    setFormNuevo({ ...FORM_VACIO });
  });

  const gruposDestino = grupos.filter(g => g.id !== grupoId);

  const formatNombreEst = (e: Estudiante) =>
    [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col justify-end sm:justify-center sm:items-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl sm:max-w-lg sm:w-full max-h-[90dvh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 flex-shrink-0">
          <h2 className="flex-1 font-bold text-slate-900 text-sm">
            Estudiantes — {grupoNombre}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">

          {/* ── Activos ── */}
          <section>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Activos ({activos.length})
            </h3>
            {activos.length === 0 && (
              <p className="text-xs text-slate-400 italic">Sin estudiantes activos.</p>
            )}
            <ul className="flex flex-col gap-1.5">
              {activos.map(({ matricula, estudiante }) => {
                const nombre = formatNombreEst(estudiante);
                const enAccion = accion?.matriculaId === matricula.id;
                return (
                  <li key={matricula.id} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <span className="flex-1 text-xs text-slate-800 font-medium leading-snug">{nombre}</span>
                      {!enAccion && (
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => { setAccion({ tipo: 'mover', matriculaId: matricula.id, nombre }); setDestGrupoId(''); }}
                            className="px-2.5 py-1 text-[10px] rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 font-medium"
                          >Mover</button>
                          <button
                            onClick={() => { setAccion({ tipo: 'retirar', matriculaId: matricula.id, nombre }); setRetiroObs(''); }}
                            className="px-2.5 py-1 text-[10px] rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-medium"
                          >Retirar</button>
                        </div>
                      )}
                    </div>

                    {/* Acción mover */}
                    {enAccion && accion!.tipo === 'mover' && (
                      <div className="border-t border-blue-100 bg-blue-50 px-3 py-2.5 flex flex-col gap-2">
                        <p className="text-[10px] text-blue-700 font-semibold">Mover a:</p>
                        <select
                          value={destGrupoId}
                          onChange={e => setDestGrupoId(e.target.value)}
                          className="text-xs text-slate-900 border border-blue-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="">— Seleccionar grupo destino —</option>
                          {gruposDestino.map(g => (
                            <option key={g.id} value={g.id}>{g.nombre}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={handleMover}
                            disabled={!destGrupoId || guardando}
                            className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50"
                          >{guardando ? '...' : 'Confirmar'}</button>
                          <button
                            onClick={() => { setAccion(null); setDestGrupoId(''); }}
                            className="px-3 py-1 text-xs rounded-lg border border-slate-300 text-slate-600"
                          >Cancelar</button>
                        </div>
                      </div>
                    )}

                    {/* Acción retirar */}
                    {enAccion && accion!.tipo === 'retirar' && (
                      <div className="border-t border-red-100 bg-red-50 px-3 py-2.5 flex flex-col gap-2">
                        <p className="text-[10px] text-red-700 font-semibold">Confirmar retiro de <span className="font-bold">{accion!.nombre}</span>:</p>
                        <input
                          type="text"
                          placeholder="Motivo u observación (opcional)"
                          value={retiroObs}
                          onChange={e => setRetiroObs(e.target.value)}
                          className="text-xs text-slate-900 border border-red-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-red-400"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleRetirar}
                            disabled={guardando}
                            className="px-3 py-1 text-xs rounded-lg bg-red-600 text-white font-medium disabled:opacity-50"
                          >{guardando ? '...' : 'Retirar'}</button>
                          <button
                            onClick={() => { setAccion(null); setRetiroObs(''); }}
                            className="px-3 py-1 text-xs rounded-lg border border-slate-300 text-slate-600"
                          >Cancelar</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ── Agregar nuevo ── */}
          <section>
            {!mostrarFormNuevo ? (
              <button
                onClick={() => setMostrarFormNuevo(true)}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-emerald-300 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 transition-colors"
              >
                + Agregar estudiante nuevo
              </button>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex flex-col gap-2">
                <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wide">Nuevo estudiante en {grupoNombre}</p>
                <div className="flex gap-1.5">
                  <select
                    value={formNuevo.tipo_doc}
                    onChange={e => setFormNuevo(f => ({ ...f, tipo_doc: e.target.value }))}
                    className="w-16 text-xs text-slate-900 border border-emerald-300 rounded-lg px-1.5 py-1.5 bg-white focus:outline-none"
                  >
                    {['T','C','PPT','CEX','RC'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="text" placeholder="Documento *" value={formNuevo.doc}
                    onChange={e => setFormNuevo(f => ({ ...f, doc: e.target.value }))}
                    className="flex-1 text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text" placeholder="Apellido 1 *" value={formNuevo.apellido1}
                    onChange={e => setFormNuevo(f => ({ ...f, apellido1: e.target.value.toUpperCase() }))}
                    className="flex-1 text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                  />
                  <input
                    type="text" placeholder="Apellido 2" value={formNuevo.apellido2}
                    onChange={e => setFormNuevo(f => ({ ...f, apellido2: e.target.value.toUpperCase() }))}
                    className="flex-1 text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                  />
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text" placeholder="Nombre 1 *" value={formNuevo.nombre1}
                    onChange={e => setFormNuevo(f => ({ ...f, nombre1: e.target.value.toUpperCase() }))}
                    className="flex-1 text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                  />
                  <input
                    type="text" placeholder="Nombre 2" value={formNuevo.nombre2}
                    onChange={e => setFormNuevo(f => ({ ...f, nombre2: e.target.value.toUpperCase() }))}
                    className="flex-1 text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                  />
                </div>
                <input
                  type="date" value={formNuevo.fecha_nacimiento}
                  onChange={e => setFormNuevo(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                  className="text-xs text-slate-900 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAgregar}
                    disabled={!formNuevo.doc || !formNuevo.apellido1 || !formNuevo.nombre1 || guardando}
                    className="px-3 py-1 text-xs rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-50"
                  >{guardando ? '...' : 'Guardar'}</button>
                  <button
                    onClick={() => { setMostrarFormNuevo(false); setFormNuevo({ ...FORM_VACIO }); }}
                    className="px-3 py-1 text-xs rounded-lg border border-slate-300 text-slate-600"
                  >Cancelar</button>
                </div>
              </div>
            )}
          </section>

          {/* ── Retirados ── */}
          {retirados.length > 0 && (
            <section>
              <button
                onClick={() => setMostrarRetirados(v => !v)}
                className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-2"
              >
                <span>{mostrarRetirados ? '▼' : '▶'}</span>
                Retirados ({retirados.length})
              </button>
              {mostrarRetirados && (
                <ul className="flex flex-col gap-1.5">
                  {retirados.map(({ matricula, estudiante }) => {
                    const nombre = formatNombreEst(estudiante);
                    return (
                      <li key={matricula.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-400 line-through leading-snug">{nombre}</p>
                          {matricula.retiro_observaciones && (
                            <p className="text-[10px] text-slate-400 mt-0.5 italic">{matricula.retiro_observaciones}</p>
                          )}
                        </div>
                        <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md flex-shrink-0">
                          RETIRADO
                        </span>
                        <button
                          onClick={() => handleReactivar(matricula.id)}
                          disabled={guardando}
                          className="text-[10px] px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium disabled:opacity-50 flex-shrink-0"
                        >
                          Reactivar
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers de UI ──────────────────────────────────────────

function VistaBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function StatChip({ label, value, color }: {
  label: string; value: number; color: 'slate' | 'emerald' | 'yellow' | 'red';
}) {
  const colors = { slate: 'text-slate-600', emerald: 'text-emerald-600', yellow: 'text-yellow-600', red: 'text-red-600' };
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-slate-500">{label}:</span>
      <span className={`font-bold ${colors[color]}`}>{value}</span>
    </div>
  );
}

function CenteredMsg({ children, dimmer }: { children: React.ReactNode; dimmer?: boolean }) {
  return (
    <div className="flex items-center justify-center h-full p-10">
      <p className={`text-sm text-center whitespace-pre-line ${dimmer ? 'text-slate-600' : 'text-slate-400'}`}>
        {children}
      </p>
    </div>
  );
}
