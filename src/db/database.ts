import Dexie, { type EntityTable } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import type {
  Area, Asignatura, Grupo, GrupoAsignatura, Estudiante, Matricula,
  ActividadCognitiva, NotaCognitiva, Calificacion, RegistroAsistencia,
  Secuencia, Sesion, RegistroClase,
} from './types';

export class SecundariaDB extends Dexie {
  areas!:                  EntityTable<Area,               'id'>;
  asignaturas!:            EntityTable<Asignatura,         'id'>;
  grupos!:                 EntityTable<Grupo,              'id'>;
  grupo_asignaturas!:      EntityTable<GrupoAsignatura,    'id'>;
  estudiantes!:            EntityTable<Estudiante,         'id'>;
  matriculas!:             EntityTable<Matricula,          'id'>;
  actividades_cognitivas!: EntityTable<ActividadCognitiva, 'id'>;
  notas_cognitivas!:       EntityTable<NotaCognitiva,      'id'>;
  calificaciones!:         EntityTable<Calificacion,       'id'>;
  registros_asistencia!:   EntityTable<RegistroAsistencia, 'id'>;
  secuencias!:             EntityTable<Secuencia,          'id'>;
  sesiones!:               EntityTable<Sesion,             'id'>;
  registros_clase!:        EntityTable<RegistroClase,      'id'>;

  constructor() {
    // v2: nombre nuevo a propósito. Cualquier navegador que ya tuviera datos
    // locales de antes de volver a modo local (de cuando la app usaba
    // Supabase directo, sin copia local) arranca con una base vacía bajo
    // este nombre y por lo tanto SIEMPRE importa la información fresca de
    // Supabase una vez, en vez de arriesgarse a mostrar datos viejos.
    super('DiarioPedagogico_v2');

    this.version(1).stores({
      areas:               'id, nombre',
      asignaturas:         'id, area_id, nombre',
      grupos:              'id, anio, nombre, [anio+nombre]',
      grupo_asignaturas:   'id, grupo_id, asignatura_id, [grupo_id+asignatura_id]',
      estudiantes:         'id, tipo_doc, doc, [tipo_doc+doc], apellido1',
      matriculas:          'id, estudiante_id, grupo_id, anio, [grupo_id+anio], [estudiante_id+anio]',
      actividades_cognitivas: 'id, grupo_id, asignatura_id, periodo, anio, [grupo_id+asignatura_id+periodo+anio]',
      notas_cognitivas:    'id, calificacion_id, actividad_id, [calificacion_id+actividad_id]',
      calificaciones:      'id, matricula_id, asignatura_id, periodo, anio, [matricula_id+asignatura_id+periodo+anio]',
      registros_asistencia:'id, matricula_id, asignatura_id, fecha, [matricula_id+asignatura_id+fecha]',
      secuencias:          'id, grupo_id, asignatura_id, periodo, anio, estado, [grupo_id+asignatura_id+anio]',
      sesiones:            'id, secuencia_id, orden, [secuencia_id+orden]',
      registros_clase:     'id, sesion_id, grupo_id, fecha, [sesion_id+grupo_id]',
    });
  }
}

export const db = new SecundariaDB();

// ── Helpers ────────────────────────────────────────────────

export async function getEstudiantesPorGrupo(grupoId: string, anio: number) {
  const todas = await db.matriculas
    .where('[grupo_id+anio]').equals([grupoId, anio]).toArray();
  // Solo activos (activo !== false cubre registros antiguos sin el campo)
  const matriculas = todas.filter(m => m.activo !== false);
  return agruparPorDocEligiendoMejor(matriculas);
}

export async function getEstudiantesRetiradosPorGrupo(grupoId: string, anio: number) {
  const todas = await db.matriculas
    .where('[grupo_id+anio]').equals([grupoId, anio]).toArray();
  const matriculas = todas.filter(m => m.activo === false);
  return agruparPorDocEligiendoMejor(matriculas);
}

// ── Dedup por documento ─────────────────────────────────────
// Pueden existir varias matrículas para el mismo estudiante (heredadas
// de siembras repetidas en distintos dispositivos, aún sin limpiar del
// todo en Supabase). Antes se tomaba "la primera" en aparecer, lo cual
// dependía del orden de iteración de IndexedDB y podía mostrar una
// copia vacía en vez de la que tiene las notas/asistencia reales.
// Cuando hay más de una matrícula para el mismo documento, se consulta
// cuál tiene señales de datos reales y se elige esa.
async function agruparPorDocEligiendoMejor(
  matriculas: Matricula[],
): Promise<{ matricula: Matricula; estudiante: Estudiante }[]> {
  const ids = matriculas.map((m) => m.estudiante_id);
  const estudiantesRaw = await db.estudiantes.bulkGet(ids);

  const porDoc = new Map<string, { matricula: Matricula; estudiante: Estudiante }[]>();
  matriculas.forEach((m, i) => {
    const est = estudiantesRaw[i];
    if (!est) return;
    const clave = `${est.tipo_doc}-${est.doc}`;
    if (!porDoc.has(clave)) porDoc.set(clave, []);
    porDoc.get(clave)!.push({ matricula: m, estudiante: est });
  });

  const idsAmbiguos = [...porDoc.values()]
    .filter((grupo) => grupo.length > 1)
    .flatMap((grupo) => grupo.map((g) => g.matricula.id));
  const senial = idsAmbiguos.length > 0 ? await calcularSenialMatriculas(idsAmbiguos) : new Map<string, number>();

  const resultado: { matricula: Matricula; estudiante: Estudiante }[] = [];
  for (const grupo of porDoc.values()) {
    if (grupo.length === 1) { resultado.push(grupo[0]); continue; }
    const mejor = [...grupo].sort(
      (a, b) => (senial.get(b.matricula.id) ?? 0) - (senial.get(a.matricula.id) ?? 0),
    )[0];
    resultado.push(mejor);
  }

  return resultado.sort((a, b) => a.estudiante.apellido1.localeCompare(b.estudiante.apellido1, 'es'));
}

/** Cuenta señales de "datos reales" por matrícula: asistencia registrada,
 *  notas cognitivas cargadas, o campos de calificación distintos del default. */
async function calcularSenialMatriculas(matriculaIds: string[]): Promise<Map<string, number>> {
  const senial = new Map<string, number>();
  for (const id of matriculaIds) senial.set(id, 0);

  const asis = await db.registros_asistencia.where('matricula_id').anyOf(matriculaIds).toArray();
  for (const a of asis) senial.set(a.matricula_id, (senial.get(a.matricula_id) ?? 0) + 1);

  const cals = await db.calificaciones.where('matricula_id').anyOf(matriculaIds).toArray();
  for (const c of cals) {
    if (c.nota_final != null || c.prueba_institucional != null) {
      senial.set(c.matricula_id, (senial.get(c.matricula_id) ?? 0) + 1);
    }
  }

  const califIds = cals.map((c) => c.id);
  if (califIds.length > 0) {
    const notas = await db.notas_cognitivas
      .where('calificacion_id').anyOf(califIds)
      .filter((n) => !!n.actividad_id)
      .toArray();
    const califAMatricula = new Map(cals.map((c) => [c.id, c.matricula_id]));
    for (const n of notas) {
      const matId = califAMatricula.get(n.calificacion_id);
      if (matId) senial.set(matId, (senial.get(matId) ?? 0) + 1);
    }
  }

  return senial;
}

// Notifica a otros módulos (Notas, etc.) que el listado de estudiantes cambió
function notificarCambioEstudiantes() {
  window.dispatchEvent(new CustomEvent('mpb:estudiantesCambiados'));
}

export async function retirarEstudiante(matriculaId: string, observaciones?: string) {
  const now = new Date().toISOString();
  const m = await db.matriculas.get(matriculaId);
  if (!m) throw new Error('Matrícula no encontrada');
  await db.matriculas.put({ ...m, activo: false, retiro_observaciones: observaciones ?? '', updated_at: now });
  notificarCambioEstudiantes();
}

export async function reactivarEstudiante(matriculaId: string) {
  const now = new Date().toISOString();
  const m = await db.matriculas.get(matriculaId);
  if (!m) throw new Error('Matrícula no encontrada');
  await db.matriculas.put({ ...m, activo: true, retiro_observaciones: undefined, updated_at: now });
  notificarCambioEstudiantes();
}

export async function moverEstudianteAGrupo(matriculaId: string, nuevoGrupoId: string) {
  const now = new Date().toISOString();
  const m = await db.matriculas.get(matriculaId);
  if (!m) throw new Error('Matrícula no encontrada');
  await db.matriculas.put({ ...m, grupo_id: nuevoGrupoId, updated_at: now });
  notificarCambioEstudiantes();
}

export async function agregarEstudianteNuevo(
  datos: { tipo_doc: string; doc: string; apellido1: string; apellido2: string; nombre1: string; nombre2: string; fecha_nacimiento: string },
  grupoId: string,
  anio: number,
) {
  const now = new Date().toISOString();
  const existente = await db.estudiantes
    .where('[tipo_doc+doc]').equals([datos.tipo_doc, datos.doc]).first();
  let estudianteId: string;
  if (existente) {
    estudianteId = existente.id;
  } else {
    estudianteId = uuidv4();
    await db.estudiantes.add({ id: estudianteId, ...datos, created_at: now, updated_at: now });
  }
  const existeM = await db.matriculas
    .where('[grupo_id+anio]').equals([grupoId, anio])
    .filter(m => m.estudiante_id === estudianteId).first();
  if (existeM) {
    if (!existeM.activo) {
      await db.matriculas.put({ ...existeM, activo: true, retiro_observaciones: undefined, updated_at: now });
    }
    return;
  }
  await db.matriculas.add({
    id: uuidv4(), estudiante_id: estudianteId,
    grupo_id: grupoId, anio, activo: true, created_at: now, updated_at: now,
  });
  notificarCambioEstudiantes();
}

export async function getCalificacion(
  matriculaId: string, asignaturaId: string, periodo: number, anio: number,
) {
  return db.calificaciones
    .where('[matricula_id+asignatura_id+periodo+anio]')
    .equals([matriculaId, asignaturaId, periodo, anio]).first();
}

export async function getResumenAsistencia(
  matriculaId: string, asignaturaId: string, fechaInicio: string, fechaFin: string,
) {
  const registros = await db.registros_asistencia
    .where('[matricula_id+asignatura_id+fecha]')
    .between([matriculaId, asignaturaId, fechaInicio], [matriculaId, asignaturaId, fechaFin], true, true)
    .toArray();
  const total     = registros.length;
  const asistidas = registros.filter((r) => r.estado === 'ASISTE').length;
  const fj        = registros.filter((r) => r.estado === 'FJ').length;
  const fi        = registros.filter((r) => r.estado === 'FI').length;
  return {
    total_horas_dictadas: total, horas_asistidas: asistidas,
    fallas_justificadas: fj, fallas_injustificadas: fi,
    porcentaje_asistencia: total > 0 ? Math.round((asistidas / total) * 100) : 0,
  };
}
