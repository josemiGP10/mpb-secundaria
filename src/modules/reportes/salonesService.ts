import { supabase } from '@/lib/supabase';
import { getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';

function client() {
  if (!supabase) throw new Error('Supabase no configurado.');
  return supabase;
}

export interface EstudianteSalon {
  nombreCompleto: string;
  grupoNombre: string;
}

/** salones[i] = lista de estudiantes del Salón i+1 */
export type Salones = EstudianteSalon[][];

function formatNombre(e: { apellido1: string; apellido2: string; nombre1: string; nombre2: string }): string {
  return [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Distribución para Prueba Institucional ────────────────
// Mezcla estudiantes de todos los grupos (incluyendo MEF) en N salones,
// repartiendo cada grupo por rondas sobre una lista barajada para que
// ningún salón concentre estudiantes del mismo curso. Los retirados
// quedan excluidos (getEstudiantesPorGrupo ya solo trae activos, con el
// mismo cruce por tipo_doc+doc usado en Asistencia/Notas para descartar
// matrículas duplicadas activo+retirado).
export async function generarDistribucionSalones(
  anio:       number,
  numSalones: number,
): Promise<Salones> {
  const { data: grupos, error } = await client().from('grupos').select('*').eq('anio', anio);
  if (error) throw new Error(error.message);
  const gruposOrdenados = [...(grupos ?? [])].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );

  const salones: Salones = Array.from({ length: numSalones }, () => []);

  for (const grupo of gruposOrdenados) {
    const [activos, retirados] = await Promise.all([
      getEstudiantesPorGrupo(grupo.id, anio),
      getEstudiantesRetiradosPorGrupo(grupo.id, anio),
    ]);
    const retiradosKeys = new Set(
      retirados.map((p) => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
    );
    const activosFiltrados = activos.filter(
      (p) => !retiradosKeys.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
    );

    // El orden de salones también se baraja por grupo: si no, el "sobrante" de
    // cada curso (cuando su cantidad de estudiantes no es múltiplo exacto de
    // numSalones) siempre cae en los salones 1, 2, 3... acumulándose ahí
    // curso tras curso y dejando los últimos salones sistemáticamente más vacíos.
    const nombres      = shuffle(activosFiltrados.map((p) => formatNombre(p.estudiante)));
    const ordenSalones = shuffle(Array.from({ length: numSalones }, (_, i) => i));
    nombres.forEach((nombreCompleto, i) => {
      const salonIdx = ordenSalones[i % numSalones];
      salones[salonIdx].push({ nombreCompleto, grupoNombre: grupo.nombre });
    });
  }

  return salones;
}
