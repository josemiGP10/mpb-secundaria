import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { clasificarNota } from './gradeEngine';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}
import {
  cargarActividades,
  cargarFilasGrupo,
  agregarActividad,
  eliminarActividad,
  guardarNotaActividad,
  borrarNotaActividad,
  guardarCalificacion,
  type FilaEstudiante,
} from './calificacionesService';
import type { ActividadCognitiva, Area, Asignatura, Grupo, TipoAsignatura } from '@/db/types';

// Notas disponibles: 1.0 a 10.0 en pasos de 0.1 (91 valores)
const NOTAS_DISPONIBLES = Array.from({ length: 91 }, (_, i) => (10 + i) / 10);

type FieldFixed = 'nota_social' | 'nota_personal' | 'prueba_institucional';

export function CalificacionesView() {
  const anio = new Date().getFullYear();

  const [grupoId,     setGrupoId]     = useState('');
  const [asigId,      setAsigId]      = useState('');
  const [periodo,     setPeriodo]     = useState(1);
  const [actividades, setActividades] = useState<ActividadCognitiva[]>([]);
  const [filas,       setFilas]       = useState<FilaEstudiante[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [modoTactil,  setModoTactil]  = useState(false);

  // Cargue masivo
  const [modoMasivo,   setModoMasivo]   = useState(false);
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set());
  const [targetMasivo, setTargetMasivo] = useState('');
  const [notaMasiva,   setNotaMasiva]   = useState(5.0);
  const [aplicando,    setAplicando]    = useState(false);

  const grupos = useLiveQuery<Grupo[]>(async () => {
    return db.grupos.where('anio').equals(anio).toArray();
  }, [anio]);

  const todasAsigs = useLiveQuery<Asignatura[]>(() => db.asignaturas.toArray(), []);
  const areas      = useLiveQuery<Area[]>(      () => db.areas.toArray(), []);

  const asignaturasGrupo = useLiveQuery<Asignatura[]>(async () => {
    if (!todasAsigs || !grupoId) return [];
    const grupoAsigs = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (grupoAsigs.length === 0) return todasAsigs;
    const ids = new Set(grupoAsigs.map((ga) => ga.asignatura_id));
    return todasAsigs.filter((a) => ids.has(a.id));
  }, [grupoId, anio, todasAsigs]) ?? [];

  const grupoSelec  = grupos?.find((g) => g.id === grupoId);
  const numPeriodos = grupoSelec?.num_periodos ?? 4;

  const asigSelec = asignaturasGrupo.find((a) => a.id === asigId);
  const areaSelec = areas?.find((a) => a.id === asigSelec?.area_id);
  const tipoArea: TipoAsignatura = areaSelec?.tipo ?? 'COMPLEMENTARIA';

  useEffect(() => {
    if (!grupoId || !asigId) { setFilas([]); setActividades([]); return; }
    setLoading(true);
    Promise.all([
      cargarActividades(grupoId, asigId, periodo, anio),
      cargarFilasGrupo(grupoId, asigId, periodo, anio),
    ])
      .then(([acts, fils]) => { setActividades(acts); setFilas(fils); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [grupoId, asigId, periodo, anio]);

  // Limpiar selección al cambiar grupo/asig/periodo
  useEffect(() => { setSelectedIds(new Set()); setTargetMasivo(''); }, [grupoId, asigId, periodo]);

  const updateFila = (matriculaId: string, patch: Partial<FilaEstudiante>) => {
    setFilas((prev) => prev.map((f) => f.matriculaId === matriculaId ? { ...f, ...patch } : f));
  };

  // ── Handlers de actividades ───────────────────────────────

  const handleAgregarActividad = useCallback(async (nombre: string) => {
    if (!grupoId || !asigId || !nombre.trim()) return;
    const act = await agregarActividad(grupoId, asigId, periodo, anio, nombre);
    setActividades((prev) => [...prev, act]);
  }, [grupoId, asigId, periodo, anio]);

  const handleEliminarActividad = useCallback(async (actividadId: string, nombre: string) => {
    if (!window.confirm(`¿Eliminar la actividad "${nombre}" y todas sus notas?`)) return;
    await eliminarActividad(actividadId);
    setActividades((prev) => prev.filter((a) => a.id !== actividadId));
    setFilas((prev) =>
      prev.map((f) => {
        const { [actividadId]: _removed, ...rest } = f.notasPorActividad;
        return { ...f, notasPorActividad: rest };
      }),
    );
  }, []);

  // ── Handler de celdas cognitivas ──────────────────────────

  const handleCognitivaChange = useCallback(async (
    matriculaId: string,
    actividadId: string,
    rawText: string,
  ) => {
    const fila = filas.find((f) => f.matriculaId === matriculaId);
    if (!fila) return;

    const v = parseFloat(rawText);
    const valid = !isNaN(v) && v >= 1.0 && v <= 10.0;
    const isEmpty = rawText.trim() === '';

    if (valid) {
      const rounded = Math.round(v * 10) / 10;
      const entry = await guardarNotaActividad(fila.calificacionId, actividadId, rounded);
      const updatedNotas = { ...fila.notasPorActividad, [actividadId]: entry };
      const nota_final = await guardarCalificacion(
        fila.calificacionId,
        { nota_social: fila.nota_social, nota_personal: fila.nota_personal, prueba_institucional: fila.prueba_institucional },
        tipoArea,
      );
      updateFila(matriculaId, { notasPorActividad: updatedNotas, nota_final });
    } else if (isEmpty && fila.notasPorActividad[actividadId]) {
      await borrarNotaActividad(fila.notasPorActividad[actividadId].notaId);
      const { [actividadId]: _, ...rest } = fila.notasPorActividad;
      const nota_final = await guardarCalificacion(
        fila.calificacionId,
        { nota_social: fila.nota_social, nota_personal: fila.nota_personal, prueba_institucional: fila.prueba_institucional },
        tipoArea,
      );
      updateFila(matriculaId, { notasPorActividad: rest, nota_final });
    }
  }, [filas, tipoArea]);

  // ── Handler de campos fijos ───────────────────────────────

  const handleFieldBlur = useCallback(async (
    matriculaId: string,
    field: FieldFixed,
    value: number,
  ) => {
    const fila = filas.find((f) => f.matriculaId === matriculaId);
    if (!fila) return;
    const updated = { ...fila, [field]: value };
    const nota_final = await guardarCalificacion(
      fila.calificacionId,
      { nota_social: updated.nota_social, nota_personal: updated.nota_personal, prueba_institucional: updated.prueba_institucional },
      tipoArea,
    );
    updateFila(matriculaId, { [field]: value, nota_final });
  }, [filas, tipoArea]);

  // ── Cargue masivo ─────────────────────────────────────────

  const handleToggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === filas.length
        ? new Set()
        : new Set(filas.map((f) => f.matriculaId)),
    );
  }, [filas]);

  const handleCargaMasiva = useCallback(async () => {
    if (!targetMasivo || selectedIds.size === 0) return;
    setAplicando(true);
    const isField = ['nota_social', 'nota_personal', 'prueba_institucional'].includes(targetMasivo);
    const ids = Array.from(selectedIds);

    const updates = await Promise.all(
      ids.map(async (matriculaId) => {
        const fila = filas.find((f) => f.matriculaId === matriculaId);
        if (!fila) return null;

        if (isField) {
          const field = targetMasivo as FieldFixed;
          const updated = { ...fila, [field]: notaMasiva };
          const nota_final = await guardarCalificacion(
            fila.calificacionId,
            { nota_social: updated.nota_social, nota_personal: updated.nota_personal, prueba_institucional: updated.prueba_institucional },
            tipoArea,
          );
          return { matriculaId, patch: { [field]: notaMasiva, nota_final } as Partial<FilaEstudiante> };
        } else {
          const entry = await guardarNotaActividad(fila.calificacionId, targetMasivo, notaMasiva);
          const updatedNotas = { ...fila.notasPorActividad, [targetMasivo]: entry };
          const nota_final = await guardarCalificacion(
            fila.calificacionId,
            { nota_social: fila.nota_social, nota_personal: fila.nota_personal, prueba_institucional: fila.prueba_institucional },
            tipoArea,
          );
          return { matriculaId, patch: { notasPorActividad: updatedNotas, nota_final } as Partial<FilaEstudiante> };
        }
      }),
    );

    setFilas((prev) =>
      prev.map((f) => {
        const upd = updates.find((u) => u?.matriculaId === f.matriculaId);
        return upd ? { ...f, ...upd.patch } : f;
      }),
    );
    setAplicando(false);
  }, [targetMasivo, selectedIds, filas, notaMasiva, tipoArea]);

  // ── Opciones de columna para cargue masivo ────────────────

  const opcionesMasivo = useMemo(() => {
    const opts: { value: string; label: string }[] = actividades.map((a) => ({
      value: a.id,
      label: `Cognitivo: ${a.nombre}`,
    }));
    if (tipoArea === 'BASICA') {
      opts.push({ value: 'prueba_institucional', label: 'Prueba institucional (20%)' });
    }
    opts.push(
      { value: 'nota_social',   label: 'Social (10%)' },
      { value: 'nota_personal', label: 'Personal (10%)' },
    );
    return opts;
  }, [actividades, tipoArea]);

  // ── Render ────────────────────────────────────────────────

  if (!grupos || !todasAsigs) return <Centered>Cargando...</Centered>;
  if (grupos.length === 0) {
    return <Centered>No hay grupos registrados. Verifique la base de datos.</Centered>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barra de selectores — 2 filas compactas */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        {/* Fila 1: grupo + asignatura */}
        <div className="flex gap-1.5">
          <select
            value={grupoId}
            onChange={(e) => { setGrupoId(e.target.value); setAsigId(''); }}
            className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="">— Grupo —</option>
            {sortGrupos(grupos ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.nombre}</option>
            ))}
          </select>
          <select
            value={asigId}
            onChange={(e) => setAsigId(e.target.value)}
            disabled={!grupoId}
            className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-40"
          >
            <option value="">— Asignatura —</option>
            {asignaturasGrupo.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </div>
        {/* Fila 2: periodo + modo + masivo + badge */}
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            {Array.from({ length: numPeriodos }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`w-8 h-7 rounded-lg text-xs font-bold transition-colors
                  ${periodo === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={modoTactil}
            onClick={() => setModoTactil((v) => !v)}
            title={modoTactil ? 'Táctil (picker)' : 'Teclado (texto)'}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-xs font-medium
              ${modoTactil ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-500'}`}
          >
            <span>{modoTactil ? '☝' : '⌨'}</span>
            <span className="hidden sm:inline">{modoTactil ? 'Táctil' : 'Teclado'}</span>
          </button>
          <button
            type="button"
            onClick={() => { setModoMasivo((v) => !v); setSelectedIds(new Set()); }}
            disabled={!grupoId || !asigId || filas.length === 0}
            title="Cargue masivo"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all text-xs font-medium disabled:opacity-40
              ${modoMasivo ? 'bg-amber-50 border-amber-400 text-amber-700' : 'bg-white border-slate-300 text-slate-500'}`}
          >
            <span>⚡</span>
            <span className="hidden sm:inline">Masivo</span>
          </button>
          {areaSelec && (
            <span className={`ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full ${
              tipoArea === 'BASICA' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
            }`}>
              {tipoArea === 'BASICA' ? 'Básica' : 'Compl.'}
            </span>
          )}
        </div>
      </div>

      {/* Panel de cargue masivo */}
      {modoMasivo && grupoId && asigId && filas.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex-shrink-0 flex-wrap">
          <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">⚡ Cargue masivo</span>

          {/* Columna destino */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-amber-600">Columna</span>
            <select
              value={targetMasivo}
              onChange={(e) => setTargetMasivo(e.target.value)}
              className="bg-white border border-amber-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 min-w-[200px]"
            >
              <option value="">— Seleccione columna —</option>
              {opcionesMasivo.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Nota a aplicar */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-amber-600">Nota</span>
            <NotaInlineInput value={notaMasiva} onChange={setNotaMasiva} />
          </div>

          {/* Sel todos / ninguno */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-amber-600">Selección</span>
            <div className="flex gap-1">
              <button
                onClick={handleSelectAll}
                className="text-xs px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                {selectedIds.size === filas.length ? 'Ninguno' : 'Todos'}
              </button>
              <span className="flex items-center text-xs text-amber-700 font-mono px-1">
                {selectedIds.size}/{filas.length}
              </span>
            </div>
          </div>

          {/* Botón aplicar */}
          <button
            onClick={handleCargaMasiva}
            disabled={aplicando || selectedIds.size === 0 || !targetMasivo}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors self-end"
          >
            {aplicando ? '...' : '✓'} Aplicar a {selectedIds.size} estudiante{selectedIds.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Grilla */}
      <div className="flex-1 overflow-auto">
        {!grupoId                                         && <Centered dimmer>Seleccione un grupo.</Centered>}
        {grupoId && !asigId                               && <Centered dimmer>Seleccione una asignatura.</Centered>}
        {loading                                          && <Centered>Cargando estudiantes...</Centered>}
        {!loading && grupoId && asigId && filas.length === 0 && <Centered>Sin estudiantes en este grupo.</Centered>}

        {!loading && filas.length > 0 && (
          <GrillaCalificaciones
            filas={filas}
            actividades={actividades}
            tipoArea={tipoArea}
            modoTactil={modoTactil}
            modoMasivo={modoMasivo}
            selectedIds={selectedIds}
            onToggleSelected={handleToggleSelected}
            onAgregarActividad={handleAgregarActividad}
            onEliminarActividad={handleEliminarActividad}
            onCognitivaChange={handleCognitivaChange}
            onFieldBlur={handleFieldBlur}
          />
        )}
      </div>
    </div>
  );
}

// ── GrillaCalificaciones ──────────────────────────────────

function GrillaCalificaciones({
  filas, actividades, tipoArea, modoTactil, modoMasivo, selectedIds, onToggleSelected,
  onAgregarActividad, onEliminarActividad,
  onCognitivaChange, onFieldBlur,
}: {
  filas: FilaEstudiante[];
  actividades: ActividadCognitiva[];
  tipoArea: TipoAsignatura;
  modoTactil: boolean;
  modoMasivo: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onAgregarActividad: (nombre: string) => Promise<void>;
  onEliminarActividad: (id: string, nombre: string) => Promise<void>;
  onCognitivaChange: (matriculaId: string, actividadId: string, rawText: string) => Promise<void>;
  onFieldBlur: (id: string, field: FieldFixed, v: number) => Promise<void>;
}) {
  const [addingAct,    setAddingAct]    = useState(false);
  const [newActNombre, setNewActNombre] = useState('');
  const inputActRef = useRef<HTMLInputElement>(null);
  const cogPct = tipoArea === 'BASICA' ? 60 : 80;

  useEffect(() => { if (addingAct) inputActRef.current?.focus(); }, [addingAct]);

  const handleAddConfirm = async () => {
    const nombre = newActNombre.trim();
    if (!nombre) return;
    await onAgregarActividad(nombre);
    setNewActNombre('');
    setAddingAct(false);
  };

  const handleAddCancel = () => { setAddingAct(false); setNewActNombre(''); };

  const cogColSpan = actividades.length + 2;

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10 bg-surface-card">
        {/* Fila 1: secciones */}
        <tr>
          {/* Columna checkbox (masivo) */}
          {modoMasivo && (
            <th rowSpan={2} className="px-2 border-b border-r border-surface-muted w-8 text-center align-bottom pb-2">
              <span className="text-[10px] text-amber-500">✓</span>
            </th>
          )}
          <th
            rowSpan={2}
            className="text-left px-4 py-2.5 text-xs text-slate-400 font-medium border-b border-r border-surface-muted min-w-[190px] align-bottom"
          >
            Estudiante
          </th>
          <th
            colSpan={cogColSpan}
            className={`text-center px-3 py-1.5 text-xs font-semibold border-b border-r border-surface-muted
              ${tipoArea === 'BASICA' ? 'text-blue-700 bg-blue-50' : 'text-purple-700 bg-purple-50'}`}
          >
            Cognitivo {cogPct}%
          </th>
          {tipoArea === 'BASICA' && (
            <th
              rowSpan={2}
              className="text-center px-3 py-2.5 text-xs text-slate-400 font-medium border-b border-r border-surface-muted w-24 align-bottom"
            >
              Prueba<br />20%
            </th>
          )}
          <th rowSpan={2} className="text-center px-3 py-2.5 text-xs text-slate-400 font-medium border-b border-r border-surface-muted w-24 align-bottom">
            Social<br />10%
          </th>
          <th rowSpan={2} className="text-center px-3 py-2.5 text-xs text-slate-400 font-medium border-b border-r border-surface-muted w-24 align-bottom">
            Personal<br />10%
          </th>
          <th rowSpan={2} className="text-center px-3 py-2.5 text-xs text-slate-400 font-medium border-b border-surface-muted w-20 align-bottom">
            Nota
          </th>
        </tr>

        {/* Fila 2: sub-columnas de actividades */}
        <tr>
          {actividades.map((act) => (
            <th key={act.id} className="text-center px-1 py-1.5 border-b border-r border-surface-muted min-w-[80px] max-w-[110px]">
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-white font-medium truncate max-w-[100px]" title={act.nombre}>
                  {act.nombre}
                </span>
                <button
                  onClick={() => onEliminarActividad(act.id, act.nombre)}
                  className="text-[9px] text-slate-500 hover:text-red-500 transition-colors"
                >
                  ✕ quitar
                </button>
              </div>
            </th>
          ))}

          {/* Columna agregar */}
          <th className="text-center px-1 py-1.5 border-b border-r border-surface-muted min-w-[90px]">
            {addingAct ? (
              <div className="flex flex-col items-center gap-1">
                <input
                  ref={inputActRef}
                  type="text"
                  value={newActNombre}
                  onChange={(e) => setNewActNombre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddConfirm();
                    if (e.key === 'Escape') handleAddCancel();
                  }}
                  placeholder="ej. Taller 1"
                  className="w-24 bg-white border border-blue-400 rounded px-2 py-1 text-[10px] text-slate-900 focus:outline-none"
                />
                <div className="flex gap-1">
                  <button onClick={handleAddConfirm} className="text-[9px] px-2 py-0.5 bg-blue-600 rounded text-white hover:bg-blue-500">OK</button>
                  <button onClick={handleAddCancel} className="text-[9px] px-2 py-0.5 bg-slate-100 rounded text-slate-700 hover:bg-slate-200">✕</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingAct(true)}
                className="flex flex-col items-center text-slate-500 hover:text-blue-400 transition-colors w-full"
              >
                <span className="text-base leading-none">+</span>
                <span className="text-[9px]">actividad</span>
              </button>
            )}
          </th>

          {/* Promedio cognitivo */}
          <th className="text-center px-1 py-1.5 border-b border-r border-surface-muted min-w-[60px]">
            <span className="text-[10px] text-slate-500 font-medium">Prom.</span>
          </th>
        </tr>
      </thead>

      <tbody>
        {filas.map((fila, i) => (
          <FilaRow
            key={fila.matriculaId}
            fila={fila}
            index={i}
            actividades={actividades}
            tipoArea={tipoArea}
            modoTactil={modoTactil}
            modoMasivo={modoMasivo}
            selected={selectedIds.has(fila.matriculaId)}
            onToggle={() => onToggleSelected(fila.matriculaId)}
            onCognitivaChange={onCognitivaChange}
            onFieldBlur={onFieldBlur}
          />
        ))}
      </tbody>
    </table>
  );
}

// ── FilaRow ───────────────────────────────────────────────

function FilaRow({
  fila, index, actividades, tipoArea, modoTactil,
  modoMasivo, selected, onToggle,
  onCognitivaChange, onFieldBlur,
}: {
  fila: FilaEstudiante;
  index: number;
  actividades: ActividadCognitiva[];
  tipoArea: TipoAsignatura;
  modoTactil: boolean;
  modoMasivo: boolean;
  selected: boolean;
  onToggle: () => void;
  onCognitivaChange: (matriculaId: string, actividadId: string, rawText: string) => Promise<void>;
  onFieldBlur: (id: string, field: FieldFixed, v: number) => Promise<void>;
}) {
  const nota = fila.nota_final;
  const { color } = nota != null ? clasificarNota(nota) : { color: 'text-slate-500' };

  const actVals = actividades
    .map((a) => fila.notasPorActividad[a.id]?.valor)
    .filter((v): v is number => v != null);
  const cogAvg = actVals.length > 0
    ? actVals.reduce((s, v) => s + v, 0) / actVals.length
    : null;

  const rowBg = modoMasivo && selected
    ? 'bg-amber-50'
    : index % 2 === 0 ? '' : 'bg-slate-50';

  return (
    <tr className={`border-b border-surface-muted/40 transition-colors ${rowBg}`}>
      {/* Checkbox masivo */}
      {modoMasivo && (
        <td className="px-2 text-center border-r border-surface-muted/30">
          <button
            onClick={onToggle}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
              ${selected
                ? 'bg-amber-500 border-amber-400 text-white'
                : 'border-slate-300 hover:border-amber-500'
              }`}
          >
            {selected && <span className="text-[10px] font-bold leading-none">✓</span>}
          </button>
        </td>
      )}

      {/* Nombre */}
      <td className="px-4 py-2 text-xs text-slate-900 leading-snug border-r border-surface-muted/30">
        <span className="text-slate-500 mr-1.5 tabular-nums">{index + 1}.</span>
        {fila.nombreCompleto}
      </td>

      {/* Celdas de actividades */}
      {actividades.map((act) => (
        <td key={act.id} className="text-center py-1 px-1 border-r border-surface-muted/20">
          <CognitivaInput
            value={fila.notasPorActividad[act.id]?.valor}
            modoTactil={modoTactil}
            onBlur={(raw) => onCognitivaChange(fila.matriculaId, act.id, raw)}
          />
        </td>
      ))}

      {/* Espacio columna + */}
      <td className="border-r border-surface-muted/20" />

      {/* Promedio cognitivo */}
      <td className="text-center px-2 py-1 border-r border-surface-muted/30">
        {cogAvg != null ? (
          <span className="font-mono font-bold text-sm tabular-nums text-blue-700">
            {cogAvg.toFixed(1)}
          </span>
        ) : (
          <span className="text-slate-600 text-xs">—</span>
        )}
      </td>

      {/* Prueba Institucional */}
      {tipoArea === 'BASICA' && (
        <td className="text-center py-1 px-2 border-r border-surface-muted/20">
          <InlineGradeInput
            value={fila.prueba_institucional}
            modoTactil={modoTactil}
            onBlur={(v) => onFieldBlur(fila.matriculaId, 'prueba_institucional', v)}
          />
        </td>
      )}

      {/* Social */}
      <td className="text-center py-1 px-2 border-r border-surface-muted/20">
        <InlineGradeInput
          value={fila.nota_social}
          modoTactil={modoTactil}
          onBlur={(v) => onFieldBlur(fila.matriculaId, 'nota_social', v)}
        />
      </td>

      {/* Personal */}
      <td className="text-center py-1 px-2 border-r border-surface-muted/20">
        <InlineGradeInput
          value={fila.nota_personal}
          modoTactil={modoTactil}
          onBlur={(v) => onFieldBlur(fila.matriculaId, 'nota_personal', v)}
        />
      </td>

      {/* Nota Final */}
      <td className="text-center px-3 py-1">
        {nota != null ? (
          <span className={`font-mono font-black text-lg tabular-nums ${color}`}>
            {nota.toFixed(1)}
          </span>
        ) : (
          <span className="text-slate-600 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

// ── NotaInlineInput ───────────────────────────────────────
// Input numérico compacto para el panel de cargue masivo.

function NotaInlineInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(1));
  useEffect(() => { setText(value.toFixed(1)); }, [value]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => { const v = Math.max(1.0, Math.round((value - 0.5) * 10) / 10); onChange(v); }}
        className="w-7 h-8 rounded bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 text-sm font-bold transition-colors"
      >−</button>
      <input
        type="number"
        step="0.1"
        min="1.0"
        max="10.0"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text);
          if (!isNaN(v) && v >= 1.0 && v <= 10.0) {
            const r = Math.round(v * 10) / 10;
            onChange(r);
            setText(r.toFixed(1));
          } else {
            setText(value.toFixed(1));
          }
        }}
        className={`w-16 h-8 rounded-lg border font-mono text-sm font-bold text-center focus:outline-none transition-colors ${colorBtnForValue(value)}`}
      />
      <button
        onClick={() => { const v = Math.min(10.0, Math.round((value + 0.5) * 10) / 10); onChange(v); }}
        className="w-7 h-8 rounded bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 text-sm font-bold transition-colors"
      >+</button>
    </div>
  );
}

// ── CognitivaInput ────────────────────────────────────────

function CognitivaInput({
  value, modoTactil, onBlur,
}: {
  value: number | undefined;
  modoTactil: boolean;
  onBlur: (rawText: string) => void;
}) {
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [anchorRect, setAnchorRect]   = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(value != null ? value.toFixed(1) : '');
  useEffect(() => { setText(value != null ? value.toFixed(1) : ''); }, [value]);

  if (modoTactil) {
    return (
      <>
        <button
          ref={btnRef}
          onClick={() => {
            setAnchorRect(btnRef.current?.getBoundingClientRect() ?? null);
            setPickerOpen(true);
          }}
          className={`w-16 h-8 rounded-lg border font-mono text-sm font-bold transition-all
            ${value != null
              ? colorBtnForValue(value)
              : 'bg-slate-100 border-slate-200 text-slate-400 hover:border-slate-400'
            }`}
        >
          {value != null ? value.toFixed(1) : '—'}
        </button>
        {pickerOpen && (
          <GradePicker
            value={value}
            anchorRect={anchorRect}
            allowClear
            onSelect={(v) => { onBlur(v.toFixed(1)); setPickerOpen(false); }}
            onClear={() => { onBlur(''); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <input
      type="number"
      step="0.1"
      min="1.0"
      max="10.0"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const raw = text.trim();
        if (raw === '') { onBlur(''); return; }
        const v = parseFloat(raw);
        if (!isNaN(v) && v >= 1.0 && v <= 10.0) {
          const r = Math.round(v * 10) / 10;
          setText(r.toFixed(1));
          onBlur(r.toFixed(1));
        } else {
          setText(value != null ? value.toFixed(1) : '');
        }
      }}
      placeholder="—"
      className={`w-16 rounded-lg px-1 py-1.5 text-center font-mono text-sm focus:outline-none transition-colors
        ${value != null
          ? 'bg-white border border-slate-300 text-slate-900 focus:border-blue-500'
          : 'bg-slate-50 border border-slate-200 text-slate-400 focus:border-blue-400 focus:bg-white'
        }`}
    />
  );
}

// ── InlineGradeInput ──────────────────────────────────────

function InlineGradeInput({
  value, modoTactil, onBlur,
}: {
  value: number | undefined;
  modoTactil: boolean;
  onBlur: (v: number) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState((value ?? 5).toFixed(1));
  useEffect(() => { setText((value ?? 5).toFixed(1)); }, [value]);

  if (modoTactil) {
    const v = value ?? 5;
    return (
      <>
        <button
          ref={btnRef}
          onClick={() => {
            setAnchorRect(btnRef.current?.getBoundingClientRect() ?? null);
            setPickerOpen(true);
          }}
          className={`w-16 h-8 rounded-lg border font-mono text-sm font-bold transition-all ${colorBtnForValue(v)}`}
        >
          {v.toFixed(1)}
        </button>
        {pickerOpen && (
          <GradePicker
            value={v}
            anchorRect={anchorRect}
            allowClear={false}
            onSelect={(sel) => { onBlur(sel); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <input
      type="number"
      step="0.1"
      min="1.0"
      max="10.0"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseFloat(text);
        if (!isNaN(v) && v >= 1.0 && v <= 10.0) {
          const r = Math.round(v * 10) / 10;
          setText(r.toFixed(1));
          onBlur(r);
        } else {
          setText((value ?? 5).toFixed(1));
        }
      }}
      className="w-16 bg-white border border-slate-300 rounded-lg px-1 py-1.5 text-center text-slate-900 font-mono text-sm focus:outline-none focus:border-blue-500"
    />
  );
}

// ── GradePicker ───────────────────────────────────────────

function GradePicker({
  value, anchorRect, allowClear, onSelect, onClear, onClose,
}: {
  value: number | undefined;
  anchorRect: DOMRect | null;
  allowClear: boolean;
  onSelect: (v: number) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const PICKER_W = 360;
  const PICKER_H = allowClear && value != null ? 420 : 390;

  const pos = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top  = anchorRect.bottom + 6;
    let left = anchorRect.left;

    if (top + PICKER_H > vh - 8) top = Math.max(8, anchorRect.top - PICKER_H - 6);
    left = Math.min(left, vw - PICKER_W - 8);
    left = Math.max(8, left);
    top  = Math.max(8, Math.min(top, vh - PICKER_H - 8));

    return { top, left };
  }, [anchorRect, PICKER_H]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={{ position: 'fixed', ...pos }}
        className="z-50 bg-white border border-slate-200 rounded-2xl shadow-2xl p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-10 gap-0.5">
          {NOTAS_DISPONIBLES.map((g) => {
            const isSel = value != null && Math.abs(value - g) < 0.001;
            return (
              <button
                key={g}
                onClick={() => onSelect(g)}
                className={`h-7 w-8 rounded border font-mono font-bold text-[10px] leading-none transition-all
                  ${isSel ? 'scale-110 ring-1 ring-slate-700 border-slate-700 z-10' : 'hover:scale-105'}
                  ${colorBtnForValue(g)}`}
              >
                {g === 10 ? '10' : g.toFixed(1)}
              </button>
            );
          })}
        </div>

        {allowClear && value != null && (
          <button
            onClick={onClear}
            className="w-full mt-1.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition-colors"
          >
            Borrar nota
          </button>
        )}

        <button
          onClick={onClose}
          className="w-full mt-1 py-1 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 text-[10px] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────

function colorBtnForValue(v: number): string {
  if (v >= 9.0) return 'bg-emerald-100 border-emerald-400 text-emerald-800 hover:bg-emerald-200';
  if (v >= 7.5) return 'bg-blue-100 border-blue-400 text-blue-800 hover:bg-blue-200';
  if (v >= 6.0) return 'bg-yellow-100 border-yellow-400 text-yellow-800 hover:bg-yellow-200';
  return 'bg-red-100 border-red-400 text-red-700 hover:bg-red-200';
}

// ── Primitivos ────────────────────────────────────────────


function Centered({ children, dimmer }: { children: React.ReactNode; dimmer?: boolean }) {
  return (
    <div className="flex items-center justify-center h-full p-10">
      <p className={`text-sm text-center whitespace-pre-line ${dimmer ? 'text-slate-600' : 'text-slate-400'}`}>{children}</p>
    </div>
  );
}