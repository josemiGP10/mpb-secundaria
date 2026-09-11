// ============================================================
//  CAPA DE DATOS — 100% en línea, directo contra Supabase.
//  Sin copia local (IndexedDB) ni sincronización: cada lectura y
//  escritura va directo a la base compartida.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import type { Calificacion, Estudiante, Matricula } from './types';

function client() {
  if (!supabase) throw new Error('Supabase no configurado.');
  return supabase;
}

// ── Helpers ────────────────────────────────────────────────

export async function getEstudiantesPorGrupo(grupoId: string, anio: number) {
  const { data: todas, error } = await client()
    .from('matriculas').select('*').eq('grupo_id', grupoId).eq('anio', anio);
  if (error) throw new Error(error.message);
  // Solo activos (activo !== false cubre registros antiguos sin el campo)
  const matriculas = (todas ?? []).filter((m) => m.activo !== false) as Matricula[];
  const ids = [...new Set(matriculas.map((m) => m.estudiante_id))];
  const estudiantes = ids.length
    ? await bulkGet<Estudiante>('estudiantes', ids)
    : new Map<string, Estudiante>();

  // Dedup por doc: pueden existir matrículas duplicadas heredadas
  const docVistos = new Set<string>();
  return matriculas
    .map((m) => ({ matricula: m, estudiante: estudiantes.get(m.estudiante_id) }))
    .filter((x): x is { matricula: Matricula; estudiante: Estudiante } => {
      if (!x.estudiante) return false;
      const clave = `${x.estudiante.tipo_doc}-${x.estudiante.doc}`;
      if (docVistos.has(clave)) return false;
      docVistos.add(clave);
      return true;
    })
    .sort((a, b) => a.estudiante.apellido1.localeCompare(b.estudiante.apellido1, 'es'));
}

export async function getEstudiantesRetiradosPorGrupo(grupoId: string, anio: number) {
  const { data: todas, error } = await client()
    .from('matriculas').select('*').eq('grupo_id', grupoId).eq('anio', anio);
  if (error) throw new Error(error.message);
  const matriculas = (todas ?? []).filter((m) => m.activo === false) as Matricula[];
  const ids = [...new Set(matriculas.map((m) => m.estudiante_id))];
  const estudiantes = ids.length
    ? await bulkGet<Estudiante>('estudiantes', ids)
    : new Map<string, Estudiante>();

  const docVistos = new Set<string>();
  return matriculas
    .map((m) => ({ matricula: m, estudiante: estudiantes.get(m.estudiante_id) }))
    .filter((x): x is { matricula: Matricula; estudiante: Estudiante } => {
      if (!x.estudiante) return false;
      const clave = `${x.estudiante.tipo_doc}-${x.estudiante.doc}`;
      if (docVistos.has(clave)) return false;
      docVistos.add(clave);
      return true;
    })
    .sort((a, b) => a.estudiante.apellido1.localeCompare(b.estudiante.apellido1, 'es'));
}

/** Trae varias filas por id en una sola consulta y las devuelve indexadas por id. */
export async function bulkGet<T extends { id: string }>(tabla: string, ids: string[]): Promise<Map<string, T>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data, error } = await client().from(tabla).select('*').in('id', unicos);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id as string, row as T]));
}

// Notifica a otros módulos (Notas, etc.) que el listado de estudiantes cambió
function notificarCambioEstudiantes() {
  window.dispatchEvent(new CustomEvent('mpb:estudiantesCambiados'));
}

export async function retirarEstudiante(matriculaId: string, observaciones?: string) {
  const now = new Date().toISOString();
  const { error } = await client().from('matriculas')
    .update({ activo: false, retiro_observaciones: observaciones ?? '', updated_at: now })
    .eq('id', matriculaId);
  if (error) throw new Error(error.message);
  notificarCambioEstudiantes();
}

export async function reactivarEstudiante(matriculaId: string) {
  const now = new Date().toISOString();
  const { error } = await client().from('matriculas')
    .update({ activo: true, retiro_observaciones: null, updated_at: now })
    .eq('id', matriculaId);
  if (error) throw new Error(error.message);
  notificarCambioEstudiantes();
}

export async function moverEstudianteAGrupo(matriculaId: string, nuevoGrupoId: string) {
  const now = new Date().toISOString();
  const { error } = await client().from('matriculas')
    .update({ grupo_id: nuevoGrupoId, updated_at: now })
    .eq('id', matriculaId);
  if (error) throw new Error(error.message);
  notificarCambioEstudiantes();
}

export async function agregarEstudianteNuevo(
  datos: { tipo_doc: string; doc: string; apellido1: string; apellido2: string; nombre1: string; nombre2: string; fecha_nacimiento: string },
  grupoId: string,
  anio: number,
) {
  const now = new Date().toISOString();
  const { data: existentes, error: e1 } = await client()
    .from('estudiantes').select('*').eq('tipo_doc', datos.tipo_doc).eq('doc', datos.doc);
  if (e1) throw new Error(e1.message);

  let estudianteId: string;
  if (existentes && existentes.length > 0) {
    estudianteId = existentes[0].id;
  } else {
    estudianteId = uuidv4();
    const { error } = await client().from('estudiantes')
      .insert({ id: estudianteId, ...datos, created_at: now, updated_at: now });
    if (error) throw new Error(error.message);
  }

  const { data: matsExistentes, error: e2 } = await client()
    .from('matriculas').select('*').eq('grupo_id', grupoId).eq('anio', anio).eq('estudiante_id', estudianteId);
  if (e2) throw new Error(e2.message);
  const existeM = matsExistentes?.[0];

  if (existeM) {
    if (!existeM.activo) {
      const { error } = await client().from('matriculas')
        .update({ activo: true, retiro_observaciones: null, updated_at: now })
        .eq('id', existeM.id);
      if (error) throw new Error(error.message);
    }
    notificarCambioEstudiantes();
    return;
  }

  const { error } = await client().from('matriculas').insert({
    id: uuidv4(), estudiante_id: estudianteId,
    grupo_id: grupoId, anio, activo: true, created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  notificarCambioEstudiantes();
}

export async function getCalificacion(
  matriculaId: string, asignaturaId: string, periodo: number, anio: number,
): Promise<Calificacion | undefined> {
  const { data, error } = await client()
    .from('calificaciones').select('*')
    .eq('matricula_id', matriculaId).eq('asignatura_id', asignaturaId)
    .eq('periodo', periodo).eq('anio', anio)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? undefined;
}

export async function getResumenAsistencia(
  matriculaId: string, asignaturaId: string, fechaInicio: string, fechaFin: string,
) {
  const { data, error } = await client()
    .from('registros_asistencia').select('*')
    .eq('matricula_id', matriculaId).eq('asignatura_id', asignaturaId)
    .gte('fecha', fechaInicio).lte('fecha', fechaFin);
  if (error) throw new Error(error.message);
  const registros = data ?? [];
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
