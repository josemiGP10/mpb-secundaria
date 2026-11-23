// ============================================================
//  IMPORTAR CARGA ACADÉMICA (archivo que exporta Horarios MPB)
//  El docente elige su nombre y se le crean en la vigencia sus
//  grupos y asignaturas. Nunca borra notas, asistencia ni grupos:
//  solo agrega o, si el docente lo pide, quita asignaturas que ya
//  no le aparecen en la carga.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { db } from '@/db/database';
import type { Area, Asignatura, Grupo, GrupoAsignatura } from '@/db/types';

export interface ArchivoCarga {
  tipo: 'mpb-carga-academica';
  version: number;
  anio: number;
  generado?: string;
  grupos: { nombre: string; horasDia?: number }[];
  docentes: { nombre: string; cargas: { asignatura: string; grupos: string[]; horasSemana: number }[] }[];
}

export function leerArchivoCarga(texto: string): ArchivoCarga {
  let j: unknown;
  try { j = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  const a = j as ArchivoCarga;
  if (!a || a.tipo !== 'mpb-carga-academica' || !Array.isArray(a.docentes)) {
    throw new Error('Este archivo no es una carga académica exportada desde Horarios MPB.');
  }
  return a;
}

/** Minúsculas, sin tildes, sin signos y con espacios simples. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[°º]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

interface InfoGrupo { clave: string; grado: number | null; mef: boolean; nombreDiario: string }

/**
 * Entiende los nombres de Horarios ("6a", "6y7", "10y11") y los del Diario
 * ("6A", "MEF 6-7 A") y les da una misma clave para emparejarlos.
 */
export function infoGrupo(nombre: string): InfoGrupo {
  const n = normalizar(nombre);
  let m = n.match(/^(?:mef )?(\d{1,2}) ?(?:y|a|-| )? ?(\d{1,2})(?: ([a-z]))?$/);
  if (m && Number(m[2]) === Number(m[1]) + 1) {
    const letra = (m[3] ?? 'a').toUpperCase();
    return { clave: `mef${m[1]}-${m[2]}${letra.toLowerCase()}`, grado: Number(m[1]), mef: true, nombreDiario: `MEF ${m[1]}-${m[2]} ${letra}` };
  }
  m = n.match(/^(\d{1,2}) ?([a-z])$/);
  if (m) return { clave: `${Number(m[1])}${m[2]}`, grado: Number(m[1]), mef: false, nombreDiario: `${Number(m[1])}${m[2].toUpperCase()}` };
  const g = n.match(/^(\d{1,2})/);
  return { clave: n, grado: g ? Number(g[1]) : null, mef: false, nombreDiario: nombre.trim() };
}

export interface PlanImportacion {
  docente: string;
  gruposNuevos: { nombre: string; grado: number; mef: boolean; desde: string }[];
  gruposExistentes: { grupo: Grupo; desde: string }[];
  /**
   * Asignaturas del archivo que no tienen una con el mismo nombre en el Diario.
   * usar = id de una asignatura existente que el docente dice que es la misma,
   * o '' para crearla nueva en el área indicada.
   */
  asignaturasNuevas: { nombre: string; horas: number; area: string; areaNueva: boolean; usar: string }[];
  /** Equivalencias usadas (nombre normalizado del archivo → id de asignatura del Diario, '' = crear). */
  equivalencias: Record<string, string>;
  /** Vínculos grupo–asignatura que quedarán (nuevo = se crea ahora). */
  vinculos: { grupo: string; asignatura: string; horas: number; nuevo: boolean }[];
  /** Asignaturas que hoy tiene el docente en grupos de la carga pero que la carga ya no trae. */
  sobrantes: { relacionId: string; grupo: string; asignatura: string }[];
  /** Grupos que no se pueden crear en el Diario (primaria o sin grado). */
  omitidos: { grupo: string; motivo: string }[];
}

const AREA_IMPORTADAS = 'Importadas del horario';

const PREFIJOS = /^(ab|ej) /;
const palabras = (s: string) => new Set(normalizar(s).replace(PREFIJOS, '').split(' ').filter(w => w.length >= 4));

/** La asignatura existente más parecida (comparte palabras y el mismo prefijo AB/EJ), o null. */
function parecida(nombre: string, asignaturas: Asignatura[]): Asignatura | null {
  const w = palabras(nombre);
  const pre = normalizar(nombre).match(PREFIJOS)?.[1] ?? '';
  let mejor: Asignatura | null = null, puntos = 0;
  for (const a of asignaturas) {
    if ((normalizar(a.nombre).match(PREFIJOS)?.[1] ?? '') !== pre) continue;
    const p = [...palabras(a.nombre)].filter(x => w.has(x)).length;
    if (p > puntos) { mejor = a; puntos = p; }
  }
  return mejor;
}

export async function planificar(archivo: ArchivoCarga, docente: string, anio: number, equivalencias?: Record<string, string>): Promise<PlanImportacion> {
  const d = archivo.docentes.find(x => x.nombre === docente);
  if (!d) throw new Error(`No se encontró a "${docente}" en el archivo.`);
  const [grupos, asignaturas, areas, relaciones] = await Promise.all([
    db.grupos.where('anio').equals(anio).toArray(), db.asignaturas.toArray(), db.areas.toArray(), db.grupo_asignaturas.toArray(),
  ]);

  const grupoPorClave = new Map(grupos.map(g => [infoGrupo(g.nombre).clave, g]));
  const asigPorNombre = new Map(asignaturas.map(a => [normalizar(a.nombre), a]));
  const asigPorId = new Map(asignaturas.map(a => [a.id, a]));
  const plan: PlanImportacion = { docente, gruposNuevos: [], gruposExistentes: [], asignaturasNuevas: [], equivalencias: {}, vinculos: [], sobrantes: [], omitidos: [] };

  // Grupos: el nombre que tendrán en el Diario, por cada nombre del archivo
  const destino = new Map<string, string>();
  const tocados = new Set<string>();   // ids de grupos existentes que aparecen en la carga
  for (const c of d.cargas) for (const gn of c.grupos) {
    if (destino.has(gn) || plan.omitidos.some(o => o.grupo === gn)) continue;
    const info = infoGrupo(gn);
    const ya = grupoPorClave.get(info.clave);
    if (ya) {
      destino.set(gn, ya.nombre); tocados.add(ya.id);
      if (!plan.gruposExistentes.some(x => x.grupo.id === ya.id)) plan.gruposExistentes.push({ grupo: ya, desde: gn });
    } else if (info.grado === null) {
      plan.omitidos.push({ grupo: gn, motivo: 'no se reconoce el grado' });
    } else if (info.grado < 6 || info.grado > 11) {
      plan.omitidos.push({ grupo: gn, motivo: info.grado < 6 ? 'es de primaria' : 'grado fuera de 6° a 11°' });
    } else {
      destino.set(gn, info.nombreDiario);
      if (!plan.gruposNuevos.some(x => x.nombre === info.nombreDiario)) plan.gruposNuevos.push({ nombre: info.nombreDiario, grado: info.grado, mef: info.mef, desde: gn });
    }
  }

  // Asignaturas: se buscan por nombre; las que falten se crean
  const areaPara = (nombre: string): { area: string; nueva: boolean } => {
    const w = palabras(nombre);
    let mejor: Area | undefined, puntos = 0;
    for (const ar of areas) {
      const p = [...palabras(ar.nombre)].filter(x => w.has(x)).length;
      if (p > puntos) { mejor = ar; puntos = p; }
    }
    return mejor ? { area: mejor.nombre, nueva: false } : { area: AREA_IMPORTADAS, nueva: !areas.some(ar => ar.nombre === AREA_IMPORTADAS) };
  };
  const vistos = new Set<string>();
  for (const c of d.cargas) {
    const n = normalizar(c.asignatura);
    let existente = asigPorNombre.get(n);
    if (!existente) {
      if (!(n in plan.equivalencias)) {
        // Si el docente ya eligió, se respeta; si no, se propone la más parecida
        const usar = equivalencias && n in equivalencias ? equivalencias[n] : (parecida(c.asignatura, asignaturas)?.id ?? '');
        plan.equivalencias[n] = asigPorId.has(usar) ? usar : '';
        const { area, nueva } = areaPara(c.asignatura);
        plan.asignaturasNuevas.push({ nombre: c.asignatura.trim(), horas: c.horasSemana, area, areaNueva: nueva, usar: plan.equivalencias[n] });
      }
      existente = asigPorId.get(plan.equivalencias[n]);
    }
    for (const gn of c.grupos) {
      const gNombre = destino.get(gn);
      if (!gNombre) continue;
      const nombreFinal = existente?.nombre ?? c.asignatura.trim();
      const clave = `${gNombre}|${existente ? 'id:' + existente.id : n}`;
      if (vistos.has(clave)) { plan.vinculos.find(v => v.grupo === gNombre && v.asignatura === nombreFinal)!.horas += c.horasSemana; continue; }
      vistos.add(clave);
      const g = grupos.find(x => x.nombre === gNombre);
      const nuevo = !g || !existente || !relaciones.some(r => r.grupo_id === g.id && r.asignatura_id === existente.id);
      plan.vinculos.push({ grupo: gNombre, asignatura: nombreFinal, horas: c.horasSemana, nuevo });
    }
  }

  // Lo que el docente tiene hoy en esos grupos y la carga ya no trae
  for (const r of relaciones) {
    if (!tocados.has(r.grupo_id)) continue;
    const g = grupos.find(x => x.id === r.grupo_id)!;
    const a = asignaturas.find(x => x.id === r.asignatura_id);
    if (!a) continue;
    if (!vistos.has(`${g.nombre}|id:${a.id}`)) plan.sobrantes.push({ relacionId: r.id, grupo: g.nombre, asignatura: a.nombre });
  }

  const orden = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
  plan.gruposNuevos.sort((a, b) => orden(a.nombre, b.nombre));
  plan.vinculos.sort((a, b) => orden(a.grupo, b.grupo) || orden(a.asignatura, b.asignatura));
  return plan;
}

/** Aplica el plan. Devuelve un resumen en palabras. */
export async function aplicar(plan: PlanImportacion, anio: number, quitarSobrantes: boolean): Promise<string> {
  const now = new Date().toISOString();
  let gruposCreados = 0, asigCreadas = 0, vinculosCreados = 0, quitados = 0;
  await db.transaction('rw', [db.grupos, db.asignaturas, db.areas, db.grupo_asignaturas], async () => {
    const areas = await db.areas.toArray();
    const areaId = async (nombre: string) => {
      let a = areas.find(x => x.nombre === nombre);
      if (!a) {
        a = { id: uuidv4(), nombre, tipo: 'BASICA', created_at: now, updated_at: now } satisfies Area;
        await db.areas.add(a); areas.push(a);
      }
      return a.id;
    };
    const asignaturas = await db.asignaturas.toArray();
    for (const n of plan.asignaturasNuevas) {
      if (n.usar || asignaturas.some(a => normalizar(a.nombre) === normalizar(n.nombre))) continue;
      const a: Asignatura = { id: uuidv4(), area_id: await areaId(n.area), nombre: n.nombre, horas_semana: n.horas, created_at: now, updated_at: now };
      await db.asignaturas.add(a); asignaturas.push(a); asigCreadas++;
    }
    const grupos = await db.grupos.where('anio').equals(anio).toArray();
    for (const n of plan.gruposNuevos) {
      if (grupos.some(g => g.nombre.toLowerCase() === n.nombre.toLowerCase())) continue;
      const g: Grupo = { id: uuidv4(), anio, nombre: n.nombre, grado_cod: n.grado, num_periodos: n.mef ? 2 : 4, created_at: now, updated_at: now };
      await db.grupos.add(g); grupos.push(g); gruposCreados++;
    }
    for (const v of plan.vinculos) {
      const g = grupos.find(x => x.nombre === v.grupo);
      const a = asignaturas.find(x => normalizar(x.nombre) === normalizar(v.asignatura));
      if (!g || !a) continue;
      const ya = await db.grupo_asignaturas.where('[grupo_id+asignatura_id]').equals([g.id, a.id]).count();
      if (ya) continue;
      await db.grupo_asignaturas.add({ id: uuidv4(), grupo_id: g.id, asignatura_id: a.id, created_at: now, updated_at: now } satisfies GrupoAsignatura);
      vinculosCreados++;
    }
    if (quitarSobrantes && plan.sobrantes.length) {
      await db.grupo_asignaturas.bulkDelete(plan.sobrantes.map(s => s.relacionId));
      quitados = plan.sobrantes.length;
    }
  });
  const partes = [
    gruposCreados && `${gruposCreados} grupo(s) creados`,
    asigCreadas && `${asigCreadas} asignatura(s) nuevas`,
    vinculosCreados && `${vinculosCreados} asignatura(s) agregadas a grupos`,
    quitados && `${quitados} quitada(s) que ya no estaban en la carga`,
  ].filter(Boolean);
  return partes.length ? `✓ Carga de ${plan.docente} importada en ${anio}: ${partes.join(', ')}.` : `Su carga ya estaba al día en ${anio}; no hubo cambios.`;
}
