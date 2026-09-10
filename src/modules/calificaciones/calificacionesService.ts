import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import { getCalificacion, getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';
import { calcularNota, buildGradeInput } from './gradeEngine';
import type { ActividadCognitiva, Calificacion, TipoAsignatura } from '@/db/types';

function client() {
  if (!supabase) throw new Error('Supabase no configurado.');
  return supabase;
}

// ── Cola de escritura por calificación ─────────────────────
// Si el docente edita varias actividades cognitivas seguidas (o una
// actividad y luego social/personal/prueba) muy rápido, cada edición
// dispara su propio guardarNotaActividad/guardarCalificacion de forma
// asíncrona. Sin esto, dos llamadas para la MISMA calificación pueden
// intercalarse: la que arrancó primero puede terminar de escribir DESPUÉS
// de la más reciente, pisando la nota_final correcta con un cálculo hecho
// sobre notas cognitivas desactualizadas.
const colasPorCalificacion = new Map<string, Promise<unknown>>();

function encolarPorCalificacion<T>(calificacionId: string, tarea: () => Promise<T>): Promise<T> {
  const anterior = colasPorCalificacion.get(calificacionId) ?? Promise.resolve();
  const actual = anterior.then(tarea, tarea);
  colasPorCalificacion.set(calificacionId, actual.then(() => undefined, () => undefined));
  return actual;
}

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
  const { data, error } = await client()
    .from('actividades_cognitivas').select('*')
    .eq('grupo_id', grupoId).eq('asignatura_id', asignaturaId).eq('periodo', periodo).eq('anio', anio)
    .order('orden');
  if (error) throw new Error(error.message);
  return data ?? [];
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
  const { error } = await client().from('actividades_cognitivas').insert(act);
  if (error) throw new Error(error.message);
  return act;
}

export async function eliminarActividad(actividadId: string): Promise<void> {
  const { error: e1 } = await client().from('notas_cognitivas').delete().eq('actividad_id', actividadId);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await client().from('actividades_cognitivas').delete().eq('id', actividadId);
  if (e2) throw new Error(e2.message);
}

// ── Notas individuales por actividad ───────────────────────

export async function guardarNotaActividad(
  calificacionId: string,
  actividadId: string,
  valor: number,
): Promise<NotaActividadEntry> {
  // Misma cola que guardarCalificacion: si esta escritura y un recálculo de
  // nota_final para la misma calificación se disparan casi al tiempo (varias
  // actividades editadas seguidas), deben quedar en fila y no intercalarse.
  return encolarPorCalificacion(calificacionId, async () => {
    const { data: existing, error: eSel } = await client()
      .from('notas_cognitivas').select('*')
      .eq('calificacion_id', calificacionId).eq('actividad_id', actividadId)
      .maybeSingle();
    if (eSel) throw new Error(eSel.message);

    if (existing) {
      const { error } = await client().from('notas_cognitivas').update({ valor }).eq('id', existing.id);
      if (error) throw new Error(error.message);
      return { notaId: existing.id, valor };
    }

    const nota = {
      id: uuidv4(),
      calificacion_id: calificacionId,
      actividad_id: actividadId,
      valor,
      created_at: new Date().toISOString(),
    };
    const { error } = await client().from('notas_cognitivas').insert(nota);
    if (error) throw new Error(error.message);
    return { notaId: nota.id, valor };
  });
}

export async function borrarNotaActividad(notaId: string): Promise<void> {
  const { error } = await client().from('notas_cognitivas').delete().eq('id', notaId);
  if (error) throw new Error(error.message);
}

// ── Carga de datos ─────────────────────────────────────────

export async function cargarFilasGrupo(
  grupoId: string,
  asignaturaId: string,
  periodo: number,
  anio: number,
): Promise<FilaEstudiante[]> {
  const [paresActivos, paresRetirados] = await Promise.all([
    getEstudiantesPorGrupo(grupoId, anio),
    getEstudiantesRetiradosPorGrupo(grupoId, anio),
  ]);
  // Si hay matrículas duplicadas (heredadas), un mismo estudiante puede
  // aparecer como activo Y retirado. La versión retirada tiene precedencia
  // (mismo criterio que en el módulo de Asistencia).
  const retiradosKeys = new Set(
    paresRetirados.map(p => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );
  const pares = paresActivos.filter(
    p => !retiradosKeys.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`)
  );
  const filas: FilaEstudiante[] = [];

  for (const { matricula, estudiante } of pares) {
    const cal = await getOrCreateCalificacion(matricula.id, asignaturaId, periodo, anio);

    const { data: notas, error } = await client()
      .from('notas_cognitivas').select('*')
      .eq('calificacion_id', cal.id).not('actividad_id', 'is', null);
    if (error) throw new Error(error.message);

    const notasPorActividad: Record<string, NotaActividadEntry> = {};
    for (const n of notas ?? []) {
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
  return encolarPorCalificacion(calificacionId, async () => {
    const { data: cal, error: eSel } = await client()
      .from('calificaciones').select('*').eq('id', calificacionId).maybeSingle();
    if (eSel) throw new Error(eSel.message);
    if (!cal) throw new Error('Calificación no encontrada');

    const { data: notas, error: eNotas } = await client()
      .from('notas_cognitivas').select('*')
      .eq('calificacion_id', calificacionId).not('actividad_id', 'is', null);
    if (eNotas) throw new Error(eNotas.message);

    let nota_final: number | undefined;
    if (notas && notas.length > 0) {
      const input = buildGradeInput(
        tipo,
        notas.map((n) => n.valor),
        campos.prueba_institucional,
        campos.nota_social,
        campos.nota_personal,
      );
      nota_final = calcularNota(input).nota_final;
    }

    const { error } = await client().from('calificaciones').update({
      ...campos,
      nota_final,
      updated_at: new Date().toISOString(),
    }).eq('id', calificacionId);
    if (error) throw new Error(error.message);
    return nota_final;
  });
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
  const { error } = await client().from('calificaciones').insert(cal);
  if (error) throw new Error(error.message);
  return cal;
}

function formatNombre(e: {
  apellido1: string; apellido2: string; nombre1: string; nombre2: string;
}): string {
  return [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');
}
