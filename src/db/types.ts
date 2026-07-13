// ============================================================
//  TIPOS — Diario Pedagógico MPB Secundaria
// ============================================================

export type EstadoAsistencia = 'ASISTE' | 'FJ' | 'FI';
export type TipoAsignatura   = 'BASICA' | 'COMPLEMENTARIA';
export type EstadoSecuencia  = 'BORRADOR' | 'ACTIVA' | 'COMPLETADA';
export type MomentoClase     = 'INICIO' | 'DESARROLLO' | 'CIERRE' | 'COMPLETA';

export interface Area {
  id: string; nombre: string; tipo: TipoAsignatura; created_at: string; updated_at: string;
}
export interface Asignatura {
  id: string; area_id: string; nombre: string; horas_semana: number; created_at: string; updated_at: string;
}
export interface Grupo {
  id: string; anio: number; nombre: string; grado_cod: number; num_periodos: number; created_at: string; updated_at: string;
}
export interface GrupoAsignatura {
  id: string; grupo_id: string; asignatura_id: string; created_at: string; updated_at: string;
}
export interface Estudiante {
  id: string; tipo_doc: string; doc: string; apellido1: string; apellido2: string;
  nombre1: string; nombre2: string; fecha_nacimiento: string; created_at: string; updated_at: string;
}
export interface Matricula {
  id: string; estudiante_id: string; grupo_id: string; anio: number; activo: boolean; created_at: string; updated_at: string;
}
export interface ActividadCognitiva {
  id: string; grupo_id: string; asignatura_id: string; periodo: number; anio: number;
  nombre: string; orden: number; created_at: string; updated_at: string;
}
export interface NotaCognitiva {
  id: string; calificacion_id: string; actividad_id?: string; valor: number; created_at: string;
}
export interface Calificacion {
  id: string; matricula_id: string; asignatura_id: string; periodo: number; anio: number;
  prueba_institucional?: number; nota_social: number; nota_personal: number; nota_final?: number;
  created_at: string; updated_at: string;
}
export interface RegistroAsistencia {
  id: string; matricula_id: string; asignatura_id: string; fecha: string;
  hora_bloque: number; estado: EstadoAsistencia; created_at: string;
}
export interface Secuencia {
  id: string; titulo: string; grupo_id: string; asignatura_id: string;
  periodo: number; anio: number; pregunta: string; objetivo: string;
  competencias: string; criterios: string; estado: EstadoSecuencia;
  created_at: string; updated_at: string;
}
export interface Sesion {
  id: string; secuencia_id: string; orden: number; titulo: string;
  inicio: string; desarrollo: string; cierre: string; recursos: string;
  duracion_bloques: number; completada: boolean; created_at: string; updated_at: string;
}
export interface RegistroClase {
  id: string; sesion_id: string | null; grupo_id: string; asignatura_id: string;
  fecha: string; momento: MomentoClase; nota_breve: string; pendiente: string;
  tarea_desc: string; tarea_fecha: string; hubo_actividad: boolean;
  created_at: string; updated_at: string;
}
export interface ResumenAsistencia {
  matricula_id: string; total_horas_dictadas: number; horas_asistidas: number;
  fallas_justificadas: number; fallas_injustificadas: number; porcentaje_asistencia: number;
}
