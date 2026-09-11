import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import { db } from '@/db/database';
import type { Secuencia, Sesion, RegistroClase, EstadoSecuencia } from '@/db/types';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}

function fechaHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─────────────────────────────────────────────────────────────
//  VISTA PRINCIPAL
// ─────────────────────────────────────────────────────────────

type Panel = 'lista' | 'nueva' | 'secuencia';

export function SecuenciasView() {
  const anio = new Date().getFullYear();
  const [panel,          setPanel]          = useState<Panel>('lista');
  const [grupoId,        setGrupoId]        = useState('');
  const [asignaturaId,   setAsignaturaId]   = useState('');
  const [secuenciaId,    setSecuenciaId]    = useState('');

  const grupos = useLiveQuery(async () => {
    return db.grupos.where('anio').equals(anio).toArray();
  }, [anio]);

  const asignaturas = useLiveQuery(async () => {
    if (!grupoId) return [];
    const links = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (links.length === 0) return db.asignaturas.toArray();
    const ids = links.map((l) => l.asignatura_id);
    const all = (await db.asignaturas.bulkGet(ids)).filter((x): x is NonNullable<typeof x> => x != null);
    return all.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [grupoId]);

  const secuencias = useLiveQuery(async () => {
    if (!grupoId || !asignaturaId) return [];
    return db.secuencias
      .where('[grupo_id+asignatura_id+anio]')
      .equals([grupoId, asignaturaId, anio])
      .reverse()
      .sortBy('created_at');
  }, [grupoId, asignaturaId, anio]);

  const openSecuencia = (id: string) => {
    setSecuenciaId(id);
    setPanel('secuencia');
  };

  if (panel === 'secuencia' && secuenciaId) {
    return (
      <SecuenciaDetalle
        secuenciaId={secuenciaId}
        grupoId={grupoId}
        asignaturaId={asignaturaId}
        onBack={() => setPanel('lista')}
      />
    );
  }

  if (panel === 'nueva') {
    return (
      <FormNuevaSecuencia
        grupoId={grupoId}
        asignaturaId={asignaturaId}
        anio={anio}
        onSaved={(id) => { setSecuenciaId(id); setPanel('secuencia'); }}
        onCancel={() => setPanel('lista')}
      />
    );
  }

  // ── Panel lista ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Selectores */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
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
        {grupoId && asignaturaId && (
          <div className="flex justify-end">
            <button
              onClick={() => setPanel('nueva')}
              className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 active:scale-95 transition-all"
            >
              + Nueva secuencia
            </button>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-4">
        {!grupoId && <Centered>Seleccione un grupo.</Centered>}
        {grupoId && !asignaturaId && <Centered>Seleccione una asignatura.</Centered>}
        {grupoId && asignaturaId && (secuencias ?? []).length === 0 && (
          <Centered>
            Sin secuencias aún.{'\n'}Toque "+ Nueva secuencia" para comenzar.
          </Centered>
        )}
        {(secuencias ?? []).map((seq) => (
          <SecuenciaCard
            key={seq.id}
            secuencia={seq}
            onClick={() => openSecuencia(seq.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  CARD DE SECUENCIA
// ─────────────────────────────────────────────────────────────

function SecuenciaCard({ secuencia, onClick }: { secuencia: Secuencia; onClick: () => void }) {
  const ESTADO_STYLES: Record<EstadoSecuencia, string> = {
    BORRADOR:   'bg-slate-100 text-slate-600',
    ACTIVA:     'bg-blue-100 text-blue-700',
    COMPLETADA: 'bg-emerald-100 text-emerald-700',
  };
  const ESTADO_LABELS: Record<EstadoSecuencia, string> = {
    BORRADOR: 'Borrador', ACTIVA: 'Activa', COMPLETADA: 'Completada',
  };
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-surface-muted bg-surface-card p-4 mb-3 hover:border-blue-400 hover:shadow-sm active:scale-[0.99] transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-900 truncate">{secuencia.titulo}</p>
          {secuencia.pregunta && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{secuencia.pregunta}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ESTADO_STYLES[secuencia.estado]}`}>
            {ESTADO_LABELS[secuencia.estado]}
          </span>
          <span className="text-[10px] text-slate-400">P{secuencia.periodo}</span>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  FORMULARIO NUEVA SECUENCIA
// ─────────────────────────────────────────────────────────────

function FormNuevaSecuencia({
  grupoId, asignaturaId, anio, onSaved, onCancel,
}: {
  grupoId: string; asignaturaId: string; anio: number;
  onSaved: (id: string) => void; onCancel: () => void;
}) {
  const [titulo,       setTitulo]       = useState('');
  const [pregunta,     setPregunta]     = useState('');
  const [objetivo,     setObjetivo]     = useState('');
  const [competencias, setCompetencias] = useState('');
  const [criterios,    setCriterios]    = useState('');
  const [periodo,      setPeriodo]      = useState(1);
  const [saving,       setSaving]       = useState(false);

  const handleSave = async () => {
    if (!titulo.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const seq: Secuencia = {
      id: uuid(), titulo: titulo.trim(), grupo_id: grupoId, asignatura_id: asignaturaId,
      periodo, anio, pregunta: pregunta.trim(), objetivo: objetivo.trim(),
      competencias: competencias.trim(), criterios: criterios.trim(),
      estado: 'BORRADOR', created_at: now, updated_at: now,
    };
    await db.secuencias.add(seq);
    setSaving(false);
    onSaved(seq.id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-muted bg-surface-card flex-shrink-0">
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-800 text-lg leading-none">←</button>
        <h2 className="font-bold text-sm text-slate-900 flex-1">Nueva Secuencia Didáctica</h2>
        <button
          onClick={handleSave}
          disabled={saving || !titulo.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-40 active:scale-95 transition-all"
        >
          {saving ? '...' : 'Guardar'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <Field label="Título *" required>
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="ej. Estructuras condicionales en Python"
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
        </Field>
        <Field label="Periodo">
          <div className="flex gap-2">
            {[1,2,3,4].map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`w-10 h-9 rounded-lg text-sm font-bold transition-colors ${
                  periodo === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Pregunta orientadora">
          <textarea
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            placeholder="¿Qué pregunta guiará esta secuencia?"
            rows={2}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </Field>
        <Field label="Objetivo">
          <textarea
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            placeholder="¿Qué lograrán los estudiantes?"
            rows={2}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </Field>
        <Field label="Competencias">
          <textarea
            value={competencias}
            onChange={(e) => setCompetencias(e.target.value)}
            placeholder="Competencias a desarrollar..."
            rows={2}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </Field>
        <Field label="Criterios de evaluación">
          <textarea
            value={criterios}
            onChange={(e) => setCriterios(e.target.value)}
            placeholder="¿Cómo se evaluará el aprendizaje?"
            rows={2}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </Field>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  DETALLE DE SECUENCIA (sesiones + registro de clase)
// ─────────────────────────────────────────────────────────────

type DetallePanel = 'sesiones' | 'registro';

function SecuenciaDetalle({
  secuenciaId, grupoId, asignaturaId, onBack,
}: {
  secuenciaId: string; grupoId: string; asignaturaId: string; onBack: () => void;
}) {
  const [subPanel,    setSubPanel]    = useState<DetallePanel>('sesiones');
  const [creandoSes,  setCreandoSes]  = useState(false);

  const secuencia = useLiveQuery(() => db.secuencias.get(secuenciaId), [secuenciaId]);
  const sesiones  = useLiveQuery(async () => {
    return db.sesiones.where('secuencia_id').equals(secuenciaId).sortBy('orden');
  }, [secuenciaId]);

  const registros = useLiveQuery(async () => {
    return db.registros_clase
      .where('grupo_id').equals(grupoId)
      .filter((r) => r.asignatura_id === asignaturaId)
      .reverse()
      .sortBy('fecha');
  }, [grupoId, asignaturaId]);

  const cambiarEstado = async (estado: EstadoSecuencia) => {
    if (!secuencia) return;
    await db.secuencias.update(secuenciaId, { estado, updated_at: new Date().toISOString() });
  };

  if (!secuencia) return <Centered>Cargando...</Centered>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-muted bg-surface-card flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-800 text-lg leading-none">←</button>
          <h2 className="font-bold text-sm text-slate-900 flex-1 truncate">{secuencia.titulo}</h2>
        </div>
        {/* Estado + sub-tabs */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-slate-300 text-xs">
            {(['sesiones', 'registro'] as DetallePanel[]).map((p) => (
              <button
                key={p}
                onClick={() => setSubPanel(p)}
                className={`px-3 py-1.5 font-medium transition-colors capitalize
                  ${subPanel === p ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
              >
                {p === 'sesiones' ? 'Sesiones' : 'Registro de clase'}
              </button>
            ))}
          </div>
          <EstadoBadge estado={secuencia.estado} onChange={cambiarEstado} />
        </div>
      </div>

      {/* Panel sesiones */}
      {subPanel === 'sesiones' && (
        <div className="flex-1 overflow-y-auto p-4">
          {(sesiones ?? []).map((ses, i) => (
            <SesionCard
              key={ses.id}
              sesion={ses}
              numero={i + 1}
              onToggleCompleta={async () => {
                await db.sesiones.update(ses.id, {
                  completada: !ses.completada,
                  updated_at: new Date().toISOString(),
                });
              }}
            />
          ))}
          {creandoSes ? (
            <FormNuevaSesion
              secuenciaId={secuenciaId}
              orden={(sesiones?.length ?? 0) + 1}
              onSaved={() => { setCreandoSes(false); }}
              onCancel={() => setCreandoSes(false)}
            />
          ) : (
            <button
              onClick={() => setCreandoSes(true)}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 text-sm transition-colors"
            >
              + Agregar sesión
            </button>
          )}
        </div>
      )}

      {/* Panel registro de clase */}
      {subPanel === 'registro' && (
        <RegistroClasePanel
          grupoId={grupoId}
          asignaturaId={asignaturaId}
          sesiones={sesiones ?? []}
          registros={registros ?? []}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  SESION CARD
// ─────────────────────────────────────────────────────────────

function SesionCard({
  sesion, numero, onToggleCompleta,
}: { sesion: Sesion; numero: number; onToggleCompleta: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-2xl border mb-3 overflow-hidden transition-colors ${
      sesion.completada ? 'border-emerald-200 bg-emerald-50' : 'border-surface-muted bg-surface-card'
    }`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition-colors ${
          sesion.completada ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-slate-300 text-slate-500'
        }`}>
          {sesion.completada ? '✓' : numero}
        </span>
        <span className={`flex-1 text-sm font-semibold ${sesion.completada ? 'text-emerald-800 line-through' : 'text-slate-900'}`}>
          {sesion.titulo || `Sesión ${numero}`}
        </span>
        <span className="text-slate-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {sesion.inicio && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Inicio</p>
              <p className="text-xs text-slate-700 whitespace-pre-line">{sesion.inicio}</p>
            </div>
          )}
          {sesion.desarrollo && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Desarrollo</p>
              <p className="text-xs text-slate-700 whitespace-pre-line">{sesion.desarrollo}</p>
            </div>
          )}
          {sesion.cierre && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Cierre</p>
              <p className="text-xs text-slate-700 whitespace-pre-line">{sesion.cierre}</p>
            </div>
          )}
          {sesion.recursos && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">Recursos</p>
              <p className="text-xs text-slate-700">{sesion.recursos}</p>
            </div>
          )}
          <button
            onClick={onToggleCompleta}
            className={`w-full py-2 rounded-xl text-xs font-semibold transition-colors ${
              sesion.completada
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            }`}
          >
            {sesion.completada ? 'Marcar incompleta' : '✓ Marcar completada'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  FORM NUEVA SESIÓN
// ─────────────────────────────────────────────────────────────

function FormNuevaSesion({
  secuenciaId, orden, onSaved, onCancel,
}: { secuenciaId: string; orden: number; onSaved: (id: string) => void; onCancel: () => void }) {
  const [titulo,     setTitulo]     = useState('');
  const [inicio,     setInicio]     = useState('');
  const [desarrollo, setDesarrollo] = useState('');
  const [cierre,     setCierre]     = useState('');
  const [recursos,   setRecursos]   = useState('');
  const [saving,     setSaving]     = useState(false);

  const handleSave = async () => {
    if (!titulo.trim() && !desarrollo.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const ses: Sesion = {
      id: uuid(), secuencia_id: secuenciaId, orden,
      titulo: titulo.trim(), inicio: inicio.trim(), desarrollo: desarrollo.trim(),
      cierre: cierre.trim(), recursos: recursos.trim(), duracion_bloques: 1,
      completada: false, created_at: now, updated_at: now,
    };
    await db.sesiones.add(ses);
    setSaving(false);
    onSaved(ses.id);
  };

  return (
    <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 flex flex-col gap-3">
      <p className="text-xs font-bold text-blue-700 uppercase">Nueva sesión #{orden}</p>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título de la sesión"
        className="w-full border border-blue-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500"
      />
      <textarea
        value={inicio}
        onChange={(e) => setInicio(e.target.value)}
        placeholder="Inicio — activación de conocimientos previos..."
        rows={2}
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 resize-none"
      />
      <textarea
        value={desarrollo}
        onChange={(e) => setDesarrollo(e.target.value)}
        placeholder="Desarrollo — actividad principal..."
        rows={3}
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 resize-none"
      />
      <textarea
        value={cierre}
        onChange={(e) => setCierre(e.target.value)}
        placeholder="Cierre — síntesis y verificación..."
        rows={2}
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 resize-none"
      />
      <input
        value={recursos}
        onChange={(e) => setRecursos(e.target.value)}
        placeholder="Recursos necesarios (opcional)"
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!titulo.trim() && !desarrollo.trim())}
          className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-40 active:scale-95 transition-all"
        >
          {saving ? '...' : 'Guardar sesión'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PANEL REGISTRO DE CLASE
// ─────────────────────────────────────────────────────────────

function RegistroClasePanel({
  grupoId, asignaturaId, sesiones, registros,
}: {
  grupoId: string; asignaturaId: string;
  sesiones: Sesion[]; registros: RegistroClase[];
}) {
  const [creando,   setCreando]   = useState(false);

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {registros.map((r) => (
        <RegistroCard key={r.id} registro={r} sesiones={sesiones} />
      ))}
      {registros.length === 0 && !creando && (
        <Centered>Sin registros aún. Toque "+ Registrar clase" para documentar una sesión.</Centered>
      )}
      {creando ? (
        <FormRegistro
          grupoId={grupoId}
          asignaturaId={asignaturaId}
          sesiones={sesiones}
          onSaved={() => setCreando(false)}
          onCancel={() => setCreando(false)}
        />
      ) : (
        <button
          onClick={() => setCreando(true)}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 text-sm transition-colors"
        >
          + Registrar clase de hoy
        </button>
      )}
    </div>
  );
}

function RegistroCard({ registro, sesiones }: { registro: RegistroClase; sesiones: Sesion[] }) {
  const sesion = sesiones.find((s) => s.id === registro.sesion_id);
  return (
    <div className="rounded-2xl border border-surface-muted bg-surface-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-900">{registro.fecha}</span>
        {sesion && <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{sesion.titulo || `Sesión ${sesion.orden}`}</span>}
        {registro.hubo_actividad && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Con actividad</span>}
      </div>
      {registro.nota_breve && (
        <p className="text-xs text-slate-700 mb-1">{registro.nota_breve}</p>
      )}
      {registro.pendiente && (
        <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg mt-1">
          <span className="font-semibold">Pendiente: </span>{registro.pendiente}
        </p>
      )}
      {registro.tarea_desc && (
        <p className="text-xs text-violet-700 bg-violet-50 px-2 py-1 rounded-lg mt-1">
          <span className="font-semibold">Tarea: </span>{registro.tarea_desc}
          {registro.tarea_fecha && <span className="text-violet-500 ml-1">para {registro.tarea_fecha}</span>}
        </p>
      )}
    </div>
  );
}

function FormRegistro({
  grupoId, asignaturaId, sesiones, onSaved, onCancel,
}: {
  grupoId: string; asignaturaId: string;
  sesiones: Sesion[]; onSaved: () => void; onCancel: () => void;
}) {
  const [sesionId,     setSesionId]     = useState(sesiones[0]?.id ?? '');
  const [fecha,        setFecha]        = useState(fechaHoy());
  const [notaBreve,    setNotaBreve]    = useState('');
  const [pendiente,    setPendiente]    = useState('');
  const [tareaDesc,    setTareaDesc]    = useState('');
  const [tareaFecha,   setTareaFecha]   = useState('');
  const [huboAct,      setHuboAct]      = useState(false);
  const [saving,       setSaving]       = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const reg: RegistroClase = {
      id: uuid(), sesion_id: sesionId || null, grupo_id: grupoId,
      asignatura_id: asignaturaId, fecha, momento: 'COMPLETA',
      nota_breve: notaBreve.trim(), pendiente: pendiente.trim(),
      tarea_desc: tareaDesc.trim(), tarea_fecha: tareaFecha,
      hubo_actividad: huboAct, created_at: now, updated_at: now,
    };
    await db.registros_clase.add(reg);
    setSaving(false);
    onSaved();
  };

  return (
    <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 flex flex-col gap-3">
      <p className="text-xs font-bold text-blue-700 uppercase">Registro de clase</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-slate-500 uppercase font-semibold">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 mt-0.5" />
        </div>
        {sesiones.length > 0 && (
          <div className="flex-1">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Sesión</label>
            <select value={sesionId} onChange={(e) => setSesionId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 mt-0.5">
              <option value="">— Ninguna —</option>
              {sesiones.map((s, i) => (
                <option key={s.id} value={s.id}>{s.titulo || `Sesión ${i+1}`}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-semibold">Nota breve de la clase</label>
        <textarea value={notaBreve} onChange={(e) => setNotaBreve(e.target.value)}
          placeholder="¿Qué ocurrió? ¿Cómo respondió el grupo?"
          rows={2}
          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 resize-none mt-0.5" />
      </div>
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-semibold">Pendiente</label>
        <input value={pendiente} onChange={(e) => setPendiente(e.target.value)}
          placeholder="Algo que quedó incompleto..."
          className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 mt-0.5" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-slate-500 uppercase font-semibold">Tarea asignada</label>
          <input value={tareaDesc} onChange={(e) => setTareaDesc(e.target.value)}
            placeholder="Descripción..."
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 mt-0.5" />
        </div>
        <div className="w-28">
          <label className="text-[10px] text-slate-500 uppercase font-semibold">Entrega</label>
          <input type="date" value={tareaFecha} onChange={(e) => setTareaFecha(e.target.value)}
            className="w-full border border-slate-300 rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 mt-0.5" />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={huboAct} onChange={(e) => setHuboAct(e.target.checked)} className="w-4 h-4 rounded" />
        <span className="text-sm text-slate-700">Hubo actividad / evaluación en clase</span>
      </label>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 disabled:opacity-40 active:scale-95 transition-all">
          {saving ? '...' : 'Guardar registro'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-white border border-slate-300 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

function EstadoBadge({
  estado, onChange,
}: { estado: EstadoSecuencia; onChange: (e: EstadoSecuencia) => void }) {
  const OPTS: EstadoSecuencia[] = ['BORRADOR', 'ACTIVA', 'COMPLETADA'];
  const LABELS: Record<EstadoSecuencia, string> = {
    BORRADOR: 'Borrador', ACTIVA: 'Activa', COMPLETADA: 'Completada',
  };
  const STYLES: Record<EstadoSecuencia, string> = {
    BORRADOR:   'bg-slate-100 text-slate-600',
    ACTIVA:     'bg-blue-100 text-blue-700',
    COMPLETADA: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <select
      value={estado}
      onChange={(e) => onChange(e.target.value as EstadoSecuencia)}
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 focus:outline-none cursor-pointer ${STYLES[estado]}`}
    >
      {OPTS.map((o) => <option key={o} value={o}>{LABELS[o]}</option>)}
    </select>
  );
}

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-slate-500 uppercase font-semibold">
        {label}{required && ' *'}
      </label>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-32">
      <p className="text-sm text-slate-400 text-center whitespace-pre-line">{children}</p>
    </div>
  );
}
