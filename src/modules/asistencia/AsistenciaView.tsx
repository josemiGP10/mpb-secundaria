import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import type { EstadoAsistencia } from '@/db/types';
import {
  cargarAsistenciaGrupo,
  cargarAsistenciaMes,
  toggleEstadoHoy,
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
//  Vista Día  — pasada de lista diaria (1 toggle por estudiante)
//  Vista Mes  — grilla mes × estudiantes para editar historico
// ============================================================

// Usa hora local del dispositivo, no UTC, para evitar desfase en zonas UTC-
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

  const [vista,        setVista]        = useState<Vista>('dia');
  const [grupoId,      setGrupoId]      = useState('');
  const [asignaturaId, setAsignaturaId] = useState('');
  const [fecha,        setFecha]        = useState(HOY);
  const [mes,          setMes]          = useState(HOY_MES);

  const grupos = useLiveQuery(async () => {
    return db.grupos.where('anio').equals(anio).toArray();
  }, [anio]);

  const asignaturas = useLiveQuery(async () => {
    if (!grupoId) return [];
    const links = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (links.length === 0) return db.asignaturas.toArray();
    // Dedup: múltiples registros con mismo asignatura_id por sync multi-dispositivo
    const ids = [...new Set(links.map((l) => l.asignatura_id))];
    const all = (await db.asignaturas.bulkGet(ids)).filter((x): x is NonNullable<typeof x> => x != null);
    return all.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [grupoId, anio]);

  // ── Estado vista día ───────────────────────────────────
  const [filas,   setFilas]   = useState<FilaAsistencia[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Estado vista mes ───────────────────────────────────
  const [grilla,      setGrilla]      = useState<{ filas: FilaMes[]; fechas: string[] } | null>(null);
  const [loadingMes,  setLoadingMes]  = useState(false);

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

  // ── Toggle vista día ───────────────────────────────────
  const handleToggleDia = async (fila: FilaAsistencia) => {
    if (busy) return;
    setBusy(true);
    try {
      const actualizado = await toggleEstadoHoy(fila, asignaturaId, fecha);
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

  // ── Render ─────────────────────────────────────────────
  if (!grupos || !asignaturas) return <CenteredMsg>Cargando...</CenteredMsg>;
  if (grupos.length === 0) {
    return <CenteredMsg>No hay grupos registrados. Verifique la base de datos.</CenteredMsg>;
  }

  const sinRegistroHoy = filas.filter((f) => f.estadoHoy === null).length;
  const listaTomada    = filas.length > 0 && sinRegistroHoy === 0;

  return (
    <div className="flex flex-col h-full">

      {/* ── Barra de selectores — 2 filas compactas ── */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        {/* Fila 1: grupo + asignatura */}
        <div className="flex gap-1.5">
          <select
            value={grupoId}
            onChange={(e) => { setGrupoId(e.target.value); setAsignaturaId(''); }}
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
          <StatChip label="Total"       value={filas.length}                                           color="slate"   />
          <StatChip label="Asisten"     value={filas.filter((f) => f.estadoHoy === 'ASISTE').length}   color="emerald" />
          <StatChip label="F.J."        value={filas.filter((f) => f.estadoHoy === 'FJ').length}       color="yellow"  />
          <StatChip label="F.I."        value={filas.filter((f) => f.estadoHoy === 'FI').length}       color="red"     />
          <StatChip label="Sin registro" value={sinRegistroHoy}                                        color="slate"   />
          <span className="ml-auto text-[10px] text-slate-600 hidden sm:block">
            Cicla: + Registrar → Asiste → F.J. → F.I. → (borra)
          </span>
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
              <DayTable filas={filas} busy={busy} onToggle={handleToggleDia} />
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
    </div>
  );
}

// ── DayTable ───────────────────────────────────────────────

function DayTable({
  filas, busy, onToggle,
}: {
  filas: FilaAsistencia[];
  busy: boolean;
  onToggle: (f: FilaAsistencia) => void;
}) {
  const registrados = filas.filter((f) => f.estadoHoy !== null).length;
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10 bg-surface-card">
        <tr>
          <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted">
            Estudiante
          </th>
          <th className="text-center px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted w-32">
            Estado hoy
          </th>
          <th className="text-center px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted">
            Histórico
          </th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila, i) => (
          <DayRow
            key={fila.matriculaId}
            fila={fila}
            idx={i}
            busy={busy}
            onToggle={() => onToggle(fila)}
          />
        ))}
      </tbody>
      <tfoot className="sticky bottom-0 bg-surface-card border-t-2 border-surface-muted">
        <tr>
          <td colSpan={3} className="px-4 py-2 text-xs text-slate-500">
            {filas.length} estudiantes · {registrados} con registro hoy
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

function DayRow({ fila, idx, busy, onToggle }: {
  fila: FilaAsistencia; idx: number; busy: boolean; onToggle: () => void;
}) {
  const pct = fila.totalSesiones > 0
    ? Math.round((fila.asistidas / fila.totalSesiones) * 100)
    : null;

  return (
    <tr className={`border-b border-surface-muted/50 ${idx % 2 !== 0 ? 'bg-slate-50' : ''}`}>
      <td className={`sticky left-0 z-10 px-2 py-2.5 text-xs leading-tight border-r border-surface-muted/20 ${idx % 2 !== 0 ? 'bg-slate-50' : 'bg-white'}`}>
        <span className="sm:hidden text-slate-900">{nombreCorto(fila.nombreCompleto)}</span>
        <span className="hidden sm:inline text-slate-900">{fila.nombreCompleto}</span>
      </td>
      <td className="text-center px-2 py-1.5">
        <EstadoBtn estado={fila.estadoHoy} disabled={busy} onClick={onToggle} />
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
                {/* Nombre — sticky */}
                <td className={`sticky left-0 z-10 ${bgBase} px-2 py-2 text-xs border-r border-surface-muted/30 min-w-[90px] sm:min-w-[160px]`}>
                  <span className="sm:hidden text-slate-900">{nombreCorto(fila.nombreCompleto)}</span>
                  <span className="hidden sm:inline text-slate-900 truncate block max-w-[155px]">{fila.nombreCompleto}</span>
                </td>

                {/* Celdas de cada fecha */}
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

                {/* Resumen mensual */}
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

// ── EstadoBtn (vista día) ──────────────────────────────────

const BTN_STYLES: Record<EstadoAsistencia, string> = {
  ASISTE: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700 border-emerald-300',
  FJ:     'bg-yellow-100 hover:bg-yellow-200 text-yellow-700 border-yellow-300',
  FI:     'bg-red-100    hover:bg-red-200    text-red-700    border-red-300',
};
const BTN_NULL = 'bg-white hover:bg-slate-100 text-slate-500 border-slate-300 border-dashed';
const BTN_LABELS: Record<EstadoAsistencia, string> = {
  ASISTE: '✓ Asiste',
  FJ:     'F. Just.',
  FI:     'F. Inj. ×',
};

function EstadoBtn({ estado, disabled, onClick }: {
  estado: EstadoAsistencia | null; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={estado === 'FI' ? 'Toque de nuevo para borrar el registro' : undefined}
      className={`
        px-3 py-1.5 rounded-lg border font-semibold text-xs transition-all
        active:scale-95 disabled:opacity-60
        ${estado === null ? BTN_NULL : BTN_STYLES[estado]}
      `}
    >
      {estado === null ? '+ Registrar' : BTN_LABELS[estado]}
    </button>
  );
}

// ── CeldaMes (vista mes) ───────────────────────────────────

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
