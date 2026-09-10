import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import { getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';
import type { EstadoAsistencia, RegistroAsistencia, RegistroClase } from '@/db/types';

function client() {
  if (!supabase) throw new Error('Supabase no configurado.');
  return supabase;
}

// ── Tipos de UI ────────────────────────────────────────────

export interface FilaAsistencia {
  matriculaId:    string;
  nombreCompleto: string;
  /** null = aún no se pasó lista este día */
  estadoHoy:      EstadoAsistencia | null;
  registroIdHoy:  string | null;
  totalSesiones:  number;
  asistidas:      number;
  fi:             number;
  fj:             number;
  a:              number;
  retirado?:      boolean;
  retiroObs?:     string;
}

export interface FilaMes {
  matriculaId:    string;
  nombreCompleto: string;
  /** fecha (YYYY-MM-DD) → estado */
  estados: Map<string, EstadoAsistencia>;
}

// ── Ciclo de estados ───────────────────────────────────────
// null → ASISTE → FJ → FI → A → null (último tap borra el registro)

const CICLO: Record<EstadoAsistencia, EstadoAsistencia | null> = {
  ASISTE: 'FJ',
  FJ:     'FI',
  FI:     'A',
  A:      null,
};

export function ciclarEstado(actual: EstadoAsistencia | null): EstadoAsistencia | null {
  if (actual === null) return 'ASISTE';
  return CICLO[actual];
}

// ── Carga vista día ────────────────────────────────────────

export async function cargarAsistenciaGrupo(
  grupoId:      string,
  anio:         number,
  asignaturaId: string,
  fecha:        string,
): Promise<FilaAsistencia[]> {
  const [paresActivos, paresRetirados] = await Promise.all([
    getEstudiantesPorGrupo(grupoId, anio),
    getEstudiantesRetiradosPorGrupo(grupoId, anio),
  ]);

  // Si hay matrículas duplicadas (heredadas), un mismo estudiante puede
  // aparecer como activo Y retirado. La versión retirada tiene precedencia.
  const retiradosKeys = new Set(
    paresRetirados.map(p => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );
  const activosFiltrados = paresActivos.filter(
    p => !retiradosKeys.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );

  const { data, error } = await client()
    .from('registros_asistencia').select('*')
    .eq('asignatura_id', asignaturaId).eq('hora_bloque', 1);
  if (error) throw new Error(error.message);
  const todosRegistros = (data ?? []) as RegistroAsistencia[];

  const porMatricula = new Map<string, RegistroAsistencia[]>();
  for (const r of todosRegistros) {
    const arr = porMatricula.get(r.matricula_id) ?? [];
    arr.push(r);
    porMatricula.set(r.matricula_id, arr);
  }

  const buildFila = (
    { matricula, estudiante }: { matricula: { id: string; retiro_observaciones?: string }; estudiante: Parameters<typeof formatNombre>[0] },
    retirado: boolean,
  ): FilaAsistencia => {
    const registros     = porMatricula.get(matricula.id) ?? [];
    const hoy           = registros.find((r) => r.fecha === fecha);
    const fechasUnicas  = new Set(registros.map((r) => r.fecha));
    const totalSesiones = fechasUnicas.size;
    const asistidas     = registros.filter((r) => r.estado === 'ASISTE').length;
    const fi            = registros.filter((r) => r.estado === 'FI').length;
    const fj            = registros.filter((r) => r.estado === 'FJ').length;
    const a             = registros.filter((r) => r.estado === 'A').length;
    return {
      matriculaId:    matricula.id,
      nombreCompleto: formatNombre(estudiante),
      estadoHoy:      hoy?.estado ?? null,
      registroIdHoy:  hoy?.id     ?? null,
      totalSesiones, asistidas, fi, fj, a,
      retirado, retiroObs: matricula.retiro_observaciones,
    };
  };

  return [
    ...activosFiltrados.map(p => buildFila(p, false)),
    ...paresRetirados.map(p   => buildFila(p, true)),
  ];
}

// ── Carga vista mes ────────────────────────────────────────

export async function cargarAsistenciaMes(
  grupoId:      string,
  anio:         number,
  asignaturaId: string,
  mes:          number, // 1–12
): Promise<{ filas: FilaMes[]; fechas: string[] }> {
  const [paresRaw, retiradosMes] = await Promise.all([
    getEstudiantesPorGrupo(grupoId, anio),
    getEstudiantesRetiradosPorGrupo(grupoId, anio),
  ]);
  const retiradosKeysMes = new Set(
    retiradosMes.map(p => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );
  const pares = paresRaw.filter(
    p => !retiradosKeysMes.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );
  const mesStr = String(mes).padStart(2, '0');
  const desde  = `${anio}-${mesStr}-01`;
  const hasta  = `${anio}-${mesStr}-31`;

  const { data, error } = await client()
    .from('registros_asistencia').select('*')
    .eq('asignatura_id', asignaturaId).eq('hora_bloque', 1)
    .gte('fecha', desde).lte('fecha', hasta);
  if (error) throw new Error(error.message);
  const registros = (data ?? []) as RegistroAsistencia[];

  const fechasSet = new Set(registros.map((r) => r.fecha));
  const fechas    = [...fechasSet].sort();

  const porMatricula = new Map<string, Map<string, EstadoAsistencia>>();
  for (const r of registros) {
    if (!porMatricula.has(r.matricula_id)) {
      porMatricula.set(r.matricula_id, new Map());
    }
    porMatricula.get(r.matricula_id)!.set(r.fecha, r.estado);
  }

  const filas: FilaMes[] = pares.map(({ matricula, estudiante }) => ({
    matriculaId:    matricula.id,
    nombreCompleto: formatNombre(estudiante),
    estados:        porMatricula.get(matricula.id) ?? new Map(),
  }));

  return { filas, fechas };
}

// ── Toggle vista día ───────────────────────────────────────

export async function toggleEstadoHoy(
  fila:         FilaAsistencia,
  asignaturaId: string,
  fecha:        string,
): Promise<Pick<FilaAsistencia, 'estadoHoy' | 'registroIdHoy' | 'totalSesiones' | 'asistidas' | 'fi' | 'fj' | 'a'>> {
  const siguiente = ciclarEstado(fila.estadoHoy);
  const now       = new Date().toISOString();

  // Cicló hasta null → borrar registro
  if (siguiente === null) {
    if (fila.registroIdHoy) {
      const { error } = await client().from('registros_asistencia').delete().eq('id', fila.registroIdHoy);
      if (error) throw new Error(error.message);
    }
    return {
      estadoHoy:     null,
      registroIdHoy: null,
      totalSesiones: Math.max(0, fila.totalSesiones - 1),
      asistidas:     fila.asistidas - (fila.estadoHoy === 'ASISTE' ? 1 : 0),
      fi:            fila.fi        - (fila.estadoHoy === 'FI'     ? 1 : 0),
      fj:            fila.fj        - (fila.estadoHoy === 'FJ'     ? 1 : 0),
      a:             fila.a         - (fila.estadoHoy === 'A'      ? 1 : 0),
    };
  }

  let registroId = fila.registroIdHoy;

  if (registroId) {
    const { error } = await client().from('registros_asistencia')
      .update({ estado: siguiente, created_at: now }).eq('id', registroId);
    if (error) throw new Error(error.message);
  } else {
    const nuevo: RegistroAsistencia = {
      id:            uuidv4(),
      matricula_id:  fila.matriculaId,
      asignatura_id: asignaturaId,
      fecha,
      hora_bloque:   1,
      estado:        siguiente,
      created_at:    now,
    };
    const { error } = await client().from('registros_asistencia').insert(nuevo);
    if (error) throw new Error(error.message);
    registroId = nuevo.id;
  }

  const eraNull = fila.estadoHoy === null;
  const delta = {
    asistidas: (siguiente === 'ASISTE' ? 1 : 0) - (fila.estadoHoy === 'ASISTE' ? 1 : 0),
    fi:        (siguiente === 'FI'     ? 1 : 0) - (fila.estadoHoy === 'FI'     ? 1 : 0),
    fj:        (siguiente === 'FJ'     ? 1 : 0) - (fila.estadoHoy === 'FJ'     ? 1 : 0),
    a:         (siguiente === 'A'      ? 1 : 0) - (fila.estadoHoy === 'A'      ? 1 : 0),
  };

  return {
    estadoHoy:     siguiente,
    registroIdHoy: registroId,
    totalSesiones: fila.totalSesiones + (eraNull ? 1 : 0),
    asistidas:     fila.asistidas + delta.asistidas,
    fi:            fila.fi        + delta.fi,
    fj:            fila.fj        + delta.fj,
    a:             fila.a         + delta.a,
  };
}

// ── Set directo (3 botones) ────────────────────────────────
// Establece el estado exacto; si ya está activo lo borra (toggle off)

export async function setEstadoDirecto(
  fila:         FilaAsistencia,
  asignaturaId: string,
  fecha:        string,
  estado:       EstadoAsistencia,
): Promise<Pick<FilaAsistencia, 'estadoHoy' | 'registroIdHoy' | 'totalSesiones' | 'asistidas' | 'fi' | 'fj' | 'a'>> {
  const now = new Date().toISOString();
  const siguiente: EstadoAsistencia | null = fila.estadoHoy === estado ? null : estado;

  if (siguiente === null) {
    if (fila.registroIdHoy) {
      const { error } = await client().from('registros_asistencia').delete().eq('id', fila.registroIdHoy);
      if (error) throw new Error(error.message);
    }
    return {
      estadoHoy:     null,
      registroIdHoy: null,
      totalSesiones: Math.max(0, fila.totalSesiones - 1),
      asistidas:     fila.asistidas - (fila.estadoHoy === 'ASISTE' ? 1 : 0),
      fi:            fila.fi        - (fila.estadoHoy === 'FI'     ? 1 : 0),
      fj:            fila.fj        - (fila.estadoHoy === 'FJ'     ? 1 : 0),
      a:             fila.a         - (fila.estadoHoy === 'A'      ? 1 : 0),
    };
  }

  let registroId = fila.registroIdHoy;
  if (registroId) {
    const { error } = await client().from('registros_asistencia')
      .update({ estado: siguiente, created_at: now }).eq('id', registroId);
    if (error) throw new Error(error.message);
  } else {
    const nuevo: RegistroAsistencia = {
      id:            uuidv4(),
      matricula_id:  fila.matriculaId,
      asignatura_id: asignaturaId,
      fecha,
      hora_bloque:   1,
      estado:        siguiente,
      created_at:    now,
    };
    const { error } = await client().from('registros_asistencia').insert(nuevo);
    if (error) throw new Error(error.message);
    registroId = nuevo.id;
  }

  const eraNull = fila.estadoHoy === null;
  const delta = {
    asistidas: (siguiente === 'ASISTE' ? 1 : 0) - (fila.estadoHoy === 'ASISTE' ? 1 : 0),
    fi:        (siguiente === 'FI'     ? 1 : 0) - (fila.estadoHoy === 'FI'     ? 1 : 0),
    fj:        (siguiente === 'FJ'     ? 1 : 0) - (fila.estadoHoy === 'FJ'     ? 1 : 0),
    a:         (siguiente === 'A'      ? 1 : 0) - (fila.estadoHoy === 'A'      ? 1 : 0),
  };

  return {
    estadoHoy:     siguiente,
    registroIdHoy: registroId,
    totalSesiones: fila.totalSesiones + (eraNull ? 1 : 0),
    asistidas:     fila.asistidas + delta.asistidas,
    fi:            fila.fi        + delta.fi,
    fj:            fila.fj        + delta.fj,
    a:             fila.a         + delta.a,
  };
}

// ── Toggle vista mes (edición de fechas pasadas) ───────────

export async function toggleEstadoFecha(
  matriculaId:  string,
  asignaturaId: string,
  fecha:        string,
  estadoActual: EstadoAsistencia | null,
): Promise<EstadoAsistencia | null> {
  const siguiente = ciclarEstado(estadoActual);
  const now       = new Date().toISOString();

  const { data, error: eSel } = await client()
    .from('registros_asistencia').select('*')
    .eq('matricula_id', matriculaId).eq('asignatura_id', asignaturaId)
    .eq('fecha', fecha).eq('hora_bloque', 1)
    .maybeSingle();
  if (eSel) throw new Error(eSel.message);
  const existente = data as RegistroAsistencia | null;

  if (siguiente === null) {
    if (existente) {
      const { error } = await client().from('registros_asistencia').delete().eq('id', existente.id);
      if (error) throw new Error(error.message);
    }
    return null;
  }

  if (existente) {
    const { error } = await client().from('registros_asistencia')
      .update({ estado: siguiente, created_at: now }).eq('id', existente.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client().from('registros_asistencia').insert({
      id:            uuidv4(),
      matricula_id:  matriculaId,
      asignatura_id: asignaturaId,
      fecha,
      hora_bloque:   1,
      estado:        siguiente,
      created_at:    now,
    });
    if (error) throw new Error(error.message);
  }

  return siguiente;
}

// ── "Tomar lista" — marcar todos presentes de golpe ───────

export async function tomarListaCompleta(
  filas:        FilaAsistencia[],
  asignaturaId: string,
  fecha:        string,
): Promise<FilaAsistencia[]> {
  const now     = new Date().toISOString();
  const nuevas: FilaAsistencia[] = [];
  const aInsertar: RegistroAsistencia[] = [];

  for (const fila of filas) {
    if (fila.retirado || fila.estadoHoy !== null) {
      nuevas.push(fila);
      continue;
    }

    const nuevo: RegistroAsistencia = {
      id:            uuidv4(),
      matricula_id:  fila.matriculaId,
      asignatura_id: asignaturaId,
      fecha,
      hora_bloque:   1,
      estado:        'ASISTE',
      created_at:    now,
    };
    aInsertar.push(nuevo);

    nuevas.push({
      ...fila,
      estadoHoy:     'ASISTE',
      registroIdHoy: nuevo.id,
      totalSesiones: fila.totalSesiones + 1,
      asistidas:     fila.asistidas + 1,
    });
  }

  if (aInsertar.length > 0) {
    const { error } = await client().from('registros_asistencia').insert(aInsertar);
    if (error) throw new Error(error.message);
  }

  return nuevas;
}

// ── Registro de clase del día (observación / pendiente / tarea) ──
// Ligado directo a grupo+asignatura+fecha, sin depender de Secuencias.

export async function cargarRegistroClaseDia(
  grupoId:      string,
  asignaturaId: string,
  fecha:        string,
): Promise<RegistroClase | undefined> {
  const { data, error } = await client()
    .from('registros_clase').select('*')
    .eq('grupo_id', grupoId).eq('asignatura_id', asignaturaId).eq('fecha', fecha)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? undefined;
}

export async function cargarUltimaObservacionAnterior(
  grupoId:      string,
  asignaturaId: string,
  fechaActual:  string,
): Promise<RegistroClase | undefined> {
  const { data, error } = await client()
    .from('registros_clase').select('*')
    .eq('grupo_id', grupoId).eq('asignatura_id', asignaturaId)
    .lt('fecha', fechaActual);
  if (error) throw new Error(error.message);
  const anteriores = (data ?? []).filter((r) => !!(r.nota_breve || r.pendiente || r.tarea_desc));
  if (anteriores.length === 0) return undefined;
  anteriores.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return anteriores[0];
}

export async function guardarRegistroClaseDia(
  grupoId:      string,
  asignaturaId: string,
  fecha:        string,
  campos: {
    nota_breve:     string;
    pendiente:      string;
    tarea_desc:     string;
    tarea_fecha:    string;
    hubo_actividad: boolean;
  },
  existenteId?: string,
): Promise<RegistroClase> {
  const now = new Date().toISOString();

  if (existenteId) {
    const { data: existente, error: eSel } = await client()
      .from('registros_clase').select('*').eq('id', existenteId).maybeSingle();
    if (eSel) throw new Error(eSel.message);
    if (existente) {
      const actualizado: RegistroClase = { ...existente, ...campos, updated_at: now };
      const { error } = await client().from('registros_clase').update(actualizado).eq('id', existenteId);
      if (error) throw new Error(error.message);
      return actualizado;
    }
  }

  const nuevo: RegistroClase = {
    id: uuidv4(),
    sesion_id:    null,
    grupo_id:     grupoId,
    asignatura_id: asignaturaId,
    fecha,
    momento: 'COMPLETA',
    ...campos,
    created_at: now,
    updated_at: now,
  };
  const { error } = await client().from('registros_clase').insert(nuevo);
  if (error) throw new Error(error.message);
  return nuevo;
}

// ── Helper ─────────────────────────────────────────────────

function formatNombre(e: {
  apellido1: string; apellido2: string; nombre1: string; nombre2: string;
}): string {
  return [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');
}
