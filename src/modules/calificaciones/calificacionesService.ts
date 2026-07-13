import { v4 as uuidv4 } from 'uuid';
import { db, getCalificacion, getEstudiantesPorGrupo } from '@/db/database';
import { calcularNota, buildGradeInput } from './gradeEngine';
import type { ActividadCognitiva, Calificacion, TipoAsignatura } from '@/db/types';

// ── Tipos de trabajo del módulo ────────────────────────────

export interface NotaActividadEntry {
  notaId: string;
  valor: number;
}

export interface FilaEstudiante {
  matriculaId: string;
  estudianteId: string;
  nombreCompleto: string;
  calificacionId: string;
  /** Mapa actividad_id → {notaId, valor}. Solo incluye actividades con valor ingresado. */
  notasPorActividad: Record<string, NotaActividadEntry>;
  prueba_institucional: number | undefined;
  nota_social: number;
  nota_personal: number;
  nota_final: number | undefined;
}

// ── Actividades cognitivas (columnas de la grilla) ─────────

export async function cargarActividades(
  grupoId: string,
  asignaturaId: string,
  periodo: number,
  anio: number,
): Promise<ActividadCognitiva[]> {
  return db.actividades_cognitivas
    .where('[grupo_id+asignatura_id+periodo+anio]')
    .equals([grupoId, asignaturaId, periodo, anio])
    .sortBy('orden');
}

export async function agregarActividad(
  grupoId: string,
  asignaturaId: string,
  periodo: number,
  anio: number,
  nombre: string,
): Promise<ActividadCognitiva> {
  const existentes = await cargarActividades(grupoId, asignaturaId, periodo, anio);
  const now = new Date().toISOString();
  const act: ActividadCognitiva = {
    id: uuidv4(),
    grupo_id: grupoId,
    asignatura_id: asignaturaId,
    periodo,
    anio,
    nombre: nombre.trim(),
    orden: existentes.length + 1,
    created_at: now,
    updated_at: now,
  };
  await db.actividades_cognitivas.add(act);
  return act;
}

export async function eliminarActividad(actividadId: string): Promise<void> {
  await db.notas_cognitivas.where('actividad_id').equals(actividadId).delete();
  await db.actividades_cognitivas.delete(actividadId);
}

// ── Notas individuales por actividad ───────────────────────

export async function guardarNotaActividad(
  calificacionId: string,
  actividadId: string,
  valor: number,
): Promise<NotaActividadEntry> {
  const existing = await db.notas_cognitivas
    .where('[calificacion_id+actividad_id]')
    .equals([calificacionId, actividadId])
    .first();

  if (existing) {
    await db.notas_cognitivas.put({ ...existing, valor });
    return { notaId: existing.id, valor };
  }

  const nota = {
    id: uuidv4(),
    calificacion_id: calificacionId,
    actividad_id: actividadId,
    valor,
    created_at: new Date().toISOString(),
  };
  await db.notas_cognitivas.add(nota);
  return { notaId: nota.id, valor };
}

export async function borrarNotaActividad(notaId: string): Promise<void> {
  await db.notas_cognitivas.delete(notaId);
}

// ── Carga de datos ─────────────────────────────────────────

export async function cargarFilasGrupo(
  grupoId: string,
  asignaturaId: string,
  periodo: number,
  anio: number,
): Promise<FilaEstudiante[]> {
  const pares = await getEstudiantesPorGrupo(grupoId, anio);
  const filas: FilaEstudiante[] = [];

  for (const { matricula, estudiante } of pares) {
    const cal = await getOrCreateCalificacion(matricula.id, asignaturaId, periodo, anio);

    const notas = await db.notas_cognitivas
      .where('calificacion_id')
      .equals(cal.id)
      .filter((n) => !!n.actividad_id)
      .toArray();

    const notasPorActividad: Record<string, NotaActividadEntry> = {};
    for (const n of notas) {
      if (n.actividad_id) {
        notasPorActividad[n.actividad_id] = { notaId: n.id, valor: n.valor };
      }
    }

    filas.push({
      matriculaId:         matricula.id,
      estudianteId:        estudiante.id,
      nombreCompleto:      formatNombre(estudiante),
      calificacionId:      cal.id,
      notasPorActividad,
      prueba_institucional: cal.prueba_institucional,
      nota_social:         cal.nota_social,
      nota_personal:       cal.nota_personal,
      nota_final:          cal.nota_final,
    });
  }

  return filas;
}

// ── Guardar componentes y recalcular nota_final ────────────

export async function guardarCalificacion(
  calificacionId: string,
  campos: {
    nota_social: number;
    nota_personal: number;
    prueba_institucional?: number;
  },
  tipo: TipoAsignatura,
): Promise<number | undefined> {
  const cal = await db.calificaciones.get(calificacionId);
  if (!cal) throw new Error('Calificación no encontrada');

  const notas = await db.notas_cognitivas
    .where('calificacion_id')
    .equals(calificacionId)
    .filter((n) => !!n.actividad_id)
    .toArray();

  let nota_final: number | undefined;
  if (notas.length > 0) {
    const input = buildGradeInput(
      tipo,
      notas.map((n) => n.valor),
      campos.prueba_institucional,
      campos.nota_social,
      campos.nota_personal,
    );
    nota_final = calcularNota(input).nota_final;
  }

  await db.calificaciones.put({
    ...cal,
    ...campos,
    nota_final,
    updated_at: new Date().toISOString(),
  });
  return nota_final;
}

// ── Helpers privados ───────────────────────────────────────

async function getOrCreateCalificacion(
  matriculaId: string,
  asignaturaId: string,
  periodo: number,
  anio: number,
): Promise<Calificacion> {
  const existing = await getCalificacion(matriculaId, asignaturaId, periodo, anio);
  if (existing) return existing;

  const now = new Date().toISOString();
  const cal: Calificacion = {
    id: uuidv4(),
    matricula_id:  matriculaId,
    asignatura_id: asignaturaId,
    periodo,
    anio,
    nota_social:   5.0,
    nota_personal: 5.0,
    created_at: now,
    updated_at: now,
  };
  await db.calificaciones.add(cal);
  return cal;
}

function formatNombre(e: {
  apellido1: string; apellido2: string; nombre1: string; nombre2: string;
}): string {
  return [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');
}
