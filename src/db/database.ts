import Dexie, { type EntityTable } from 'dexie';
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
    super('DiarioPedagogico_v1');

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
  const matriculas = await db.matriculas
    .where('[grupo_id+anio]').equals([grupoId, anio]).toArray();
  const ids = matriculas.map((m) => m.estudiante_id);
  const estudiantes = await db.estudiantes.bulkGet(ids);

  // Dedup por doc: varios dispositivos sembraron IDs distintos para el mismo estudiante
  const docVistos = new Set<string>();
  return matriculas
    .map((m, i) => ({ matricula: m, estudiante: estudiantes[i]! }))
    .filter(({ estudiante }) => {
      if (!estudiante) return false;
      const clave = `${estudiante.tipo_doc}-${estudiante.doc}`;
      if (docVistos.has(clave)) return false;
      docVistos.add(clave);
      return true;
    })
    .sort((a, b) => a.estudiante.apellido1.localeCompare(b.estudiante.apellido1, 'es'));
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
