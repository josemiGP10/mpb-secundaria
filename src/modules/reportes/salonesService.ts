import { db, getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';

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
  const grupos = await db.grupos.where('anio').equals(anio).toArray();
  const gruposOrdenados = [...grupos].sort((a, b) =>
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

    const nombres = shuffle(activosFiltrados.map((p) => formatNombre(p.estudiante)));
    nombres.forEach((nombreCompleto, i) => {
      salones[i % numSalones].push({ nombreCompleto, grupoNombre: grupo.nombre });
    });
  }

  return salones;
}
