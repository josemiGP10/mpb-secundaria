// ============================================================
//  CONSEJO ACADÉMICO — lectura de consolidados y decisiones
//  Fuente: los Excel "consolidadoGruposAreas" y
//  "consolidadoGruposAsignaturas" que exporta la plataforma de
//  notas. Todo queda guardado local (IndexedDB), como el resto
//  de la app; no se sube al respaldo de Supabase.
// ============================================================

import { db } from '@/db/database';
import { leerPrimeraHoja, type Celda } from './xlsxLite';

export const CORTES = ['FINAL', 'P.1', 'P.2', 'P.3', 'P.4'] as const;
export type Corte = typeof CORTES[number];
export const PERIODOS: Corte[] = ['P.1', 'P.2', 'P.3', 'P.4'];

export type Notas = Record<string, number | null>;

export interface EstudianteConsejo {
  nombre: string;
  areas: Partial<Record<Corte, Notas>>;
  asignaturas?: Partial<Record<Corte, Notas>>;
}

export interface GrupoConsejo {
  clave: string;        // nombre tal cual viene ("Sexto A Unica")
  nombre: string;       // legible ("6° A")
  grado: number;
  areas: string[];
  asignaturas: string[];
  estudiantes: EstudianteConsejo[];
}

export interface ImportConsejo {
  id: 'actual';
  importado_at: string;
  archivo_areas: string;
  archivo_asignaturas: string | null;
  grupos: GrupoConsejo[];
}

export type Decision =
  | 'PENDIENTE' | 'PROMOVIDO' | 'RECUPERACION' | 'RECUPERO' | 'NO_PROMOVIDO' | 'RETIRADO';

export const DECISIONES: { id: Decision; label: string; color: string }[] = [
  { id: 'PENDIENTE',    label: 'Pendiente',                     color: 'bg-slate-100 text-slate-600' },
  { id: 'PROMOVIDO',    label: 'Promovido',                     color: 'bg-emerald-100 text-emerald-800' },
  { id: 'RECUPERACION', label: 'Va a recuperación',             color: 'bg-amber-100 text-amber-800' },
  { id: 'RECUPERO',     label: 'Recuperó → promovido',          color: 'bg-teal-100 text-teal-800' },
  { id: 'NO_PROMOVIDO', label: 'No promovido (repite el año)',  color: 'bg-red-100 text-red-800' },
  { id: 'RETIRADO',     label: 'Retirado / sin notas',          color: 'bg-slate-200 text-slate-700' },
];
export const labelDecision = (d: Decision) => DECISIONES.find(x => x.id === d)?.label ?? d;

export interface DecisionConsejo {
  id: string;           // `${corte}|${grupo}|${nombre}`
  corte: Corte;
  grupo: string;
  nombre: string;
  decision: Decision;
  observacion: string;
  updated_at: string;
}

export interface ConfigConsejo {
  notaMinima: number;          // un área se pierde con nota < notaMinima
  areasParaReprobar: number;   // con esta cantidad o más de áreas perdidas, se sugiere "No promovido"
}
export const CONFIG_DEFAULT: ConfigConsejo = { notaMinima: 6.5, areasParaReprobar: 3 };

// ── Catálogo de áreas y asignaturas (códigos de la plataforma) ──

export const NOMBRE_AREA: Record<string, string> = {
  CNAT:   'Ciencias Naturales',
  EA:     'Artística y Emprendimiento',
  ART:    'Educación Artística',
  EDUFIS: 'Educación Física',
  HUM:    'Humanidades',
  HLCI:   'Humanidades (Castellano e Idiomas)',
  INFOR:  'Informática y Tecnología',
  MAT:    'Matemáticas',
  MOT:    'Ejes (MOT)',
  RU:     'Ética y Religión (RU)',
  SOC:    'Ciencias Sociales',
};
export const nombreArea = (c: string) => NOMBRE_AREA[c] ?? c;

// A qué área pertenece cada asignatura. Deducido de los propios
// consolidados: la nota del área es el promedio ponderado (por
// intensidad horaria) de estas asignaturas en cada período.
// Si una asignatura puede caer en dos áreas según el grado, se
// toma la primera que exista en el grupo.
const AREA_DE_ASIGNATURA: Record<string, string[]> = {
  NAT: ['CNAT'], PFQ: ['CNAT'], BIOLO: ['CNAT'], FISIC: ['CNAT'], QUIM: ['CNAT'],
  ART: ['EA', 'ART'], ART1: ['ART', 'EA'], EMPR: ['EA'],
  EFIS: ['EDUFIS'],
  'C TEX': ['HUM', 'HLCI'], 'L CAS': ['HUM', 'HLCI'], 'L EXT': ['HUM', 'HLCI'], 'OR CA': ['HUM', 'HLCI'],
  LCAST: ['HLCI', 'HUM'], LEXTR: ['HLCI', 'HUM'], LCRIT: ['HUM', 'HLCI'],
  'I Y T': ['INFOR'],
  MAT: ['MAT'], RESPR: ['MAT'], 'E Y G': ['MAT'], GEOM: ['MAT'], EST: ['MAT'],
  E2: ['MOT'], ECIYT: ['MOT'], ECLUB: ['MOT'], EJARY: ['MOT'], EJTUR: ['MOT'], Ej: ['MOT'],
  AFROC: ['RU'], ERyP: ['RU'],
  SOC: ['SOC'], CCIU: ['SOC'], GEOG: ['SOC'], HIST: ['SOC'], CYECO: ['SOC'], FIL: ['SOC'],
};

export function asignaturasDeArea(grupo: GrupoConsejo, area: string): string[] {
  return grupo.asignaturas.filter(a => {
    const cands = AREA_DE_ASIGNATURA[a];
    if (!cands) return false;
    return cands.find(c => grupo.areas.includes(c)) === area;
  });
}

// ── Lectura del consolidado ─────────────────────────────────

const GRADOS: [RegExp, number][] = [
  [/^und[eé]cimo/i, 11], [/^d[eé]cimo/i, 10], [/^noveno/i, 9],
  [/^octavo/i, 8], [/^s[eé]ptimo/i, 7], [/^sexto/i, 6],
];

function nombreGrupo(raw: string): { nombre: string; grado: number } {
  const limpio = raw.replace(/\s+/g, ' ').trim();
  for (const [re, g] of GRADOS) {
    if (re.test(limpio)) {
      const letra = limpio.split(' ')[1] ?? '';
      return { nombre: `${g}° ${/^[A-Z]$/i.test(letra) ? letra.toUpperCase() : ''}`.trim(), grado: g };
    }
  }
  return { nombre: limpio, grado: 99 };
}

const normNombre = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const aNota = (v: Celda): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);

interface GrupoLeido {
  clave: string;
  cols: string[];
  idx: { j: number; c: string }[];   // columna del Excel → código de área/asignatura
  est: Map<string, Partial<Record<Corte, Notas>>>;
}

function parsearConsolidado(filas: Celda[][]): GrupoLeido[] {
  const grupos: GrupoLeido[] = [];
  let g: GrupoLeido | null = null;
  let actual: Partial<Record<Corte, Notas>> | null = null;
  for (let i = 0; i < filas.length; i++) {
    const r = filas[i];
    if (r[0] === 'Grupo') {
      const hdr = filas[i + 1] ?? [];
      const cols: { j: number; c: string }[] = [];
      for (let j = 9; j < hdr.length; j++) if (hdr[j] != null && String(hdr[j]).trim()) cols.push({ j, c: String(hdr[j]).trim() });
      g = { clave: String(r[1] ?? '').replace(/\s+/g, ' ').trim(), cols: cols.map(x => x.c), idx: cols, est: new Map() };
      grupos.push(g);
      actual = null;
      continue;
    }
    if (!g) continue;
    const corte = typeof r[5] === 'string' ? r[5].trim() : '';
    if (!(CORTES as readonly string[]).includes(corte)) continue;
    if (corte === 'FINAL') {
      const nombre = normNombre(r[0]);
      // Las filas "1. superior", "2. alto"... al final de cada grupo son
      // conteos de desempeño, no estudiantes.
      if (!nombre || /^\d+\./.test(nombre)) { actual = null; continue; }
      actual = {};
      g.est.set(nombre, actual);
    }
    if (!actual) continue;
    const notas: Notas = {};
    for (const { j, c } of g.idx) notas[c] = aNota(r[j] ?? null);
    actual[corte as Corte] = notas;
  }
  return grupos;
}

export async function importarConsolidados(fileAreas: File, fileAsig: File | null): Promise<ImportConsejo> {
  const areas = parsearConsolidado(await leerPrimeraHoja(fileAreas));
  if (areas.length === 0) throw new Error('No se encontraron grupos en el consolidado de áreas. ¿Es el archivo correcto?');
  const asigs = fileAsig ? parsearConsolidado(await leerPrimeraHoja(fileAsig)) : [];
  if (fileAsig && asigs.length === 0) throw new Error('No se encontraron grupos en el consolidado de asignaturas.');

  const grupos: GrupoConsejo[] = areas.map(ga => {
    const gs = asigs.find(x => x.clave === ga.clave);
    const { nombre, grado } = nombreGrupo(ga.clave);
    return {
      clave: ga.clave, nombre, grado,
      areas: ga.cols,
      asignaturas: gs?.cols ?? [],
      estudiantes: [...ga.est.entries()].map(([n, notas]) => ({
        nombre: n, areas: notas, asignaturas: gs?.est.get(n),
      })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  }).sort((a, b) => a.grado - b.grado || a.nombre.localeCompare(b.nombre, 'es'));

  const data: ImportConsejo = {
    id: 'actual',
    importado_at: new Date().toISOString(),
    archivo_areas: fileAreas.name,
    archivo_asignaturas: fileAsig?.name ?? null,
    grupos,
  };
  await db.consejo_import.put(data);
  return data;
}

// ── Análisis por estudiante ─────────────────────────────────

export interface Analisis {
  /** incompleta: la nota final del área se calculó con algún período sin nota. */
  perdidas: { area: string; nota: number; incompleta: boolean }[];
  sinNota: string[];
  sinNingunaNota: boolean;
  promedio: number | null;
}

export function analizar(e: EstudianteConsejo, grupo: GrupoConsejo, corte: Corte, cfg: ConfigConsejo): Analisis {
  const notas = e.areas[corte] ?? {};
  const perdidas: Analisis['perdidas'] = [];
  const sinNota: string[] = [];
  const vals: number[] = [];
  for (const a of grupo.areas) {
    const v = notas[a];
    if (v == null) { sinNota.push(a); continue; }
    vals.push(v);
    const incompleta = corte === 'FINAL' && PERIODOS.some(p => e.areas[p]?.[a] == null);
    if (v < cfg.notaMinima) perdidas.push({ area: a, nota: v, incompleta });
  }
  return {
    perdidas: perdidas.sort((x, y) => x.nota - y.nota),
    sinNota,
    sinNingunaNota: vals.length === 0,
    promedio: vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null,
  };
}

/** Áreas de un grupo donde a la mayoría le falta la nota de un período:
 *  típicamente un docente que aún no subió el P4 a la plataforma. */
export function periodosIncompletos(grupo: GrupoConsejo): { area: string; periodo: Corte; faltan: number }[] {
  const res: { area: string; periodo: Corte; faltan: number }[] = [];
  const n = grupo.estudiantes.length;
  for (const a of grupo.areas) {
    for (const p of PERIODOS) {
      const faltan = grupo.estudiantes.filter(e => e.areas[p]?.[a] == null).length;
      if (n > 0 && faltan / n >= 0.5) res.push({ area: a, periodo: p, faltan });
    }
  }
  return res;
}

export function decisionSugerida(a: Analisis, corte: Corte, cfg: ConfigConsejo): Decision {
  if (a.sinNingunaNota) return 'RETIRADO';
  if (a.perdidas.length === 0) return 'PROMOVIDO';
  if (corte === 'FINAL' && a.perdidas.length >= cfg.areasParaReprobar) return 'NO_PROMOVIDO';
  return 'RECUPERACION';
}

export const idDecision = (corte: Corte, grupo: string, nombre: string) => `${corte}|${grupo}|${nombre}`;

export async function guardarDecision(
  corte: Corte, grupo: string, nombre: string, cambios: Partial<Pick<DecisionConsejo, 'decision' | 'observacion'>>,
): Promise<void> {
  const id = idDecision(corte, grupo, nombre);
  const prev = await db.consejo_decisiones.get(id);
  await db.consejo_decisiones.put({
    id, corte, grupo, nombre,
    decision: cambios.decision ?? prev?.decision ?? 'PENDIENTE',
    observacion: cambios.observacion ?? prev?.observacion ?? '',
    updated_at: new Date().toISOString(),
  });
}

// ── Configuración (preferencia de este equipo) ──────────────
const CFG_KEY = 'mpb_sec_consejo_cfg';
export function leerConfig(): ConfigConsejo {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? { ...CONFIG_DEFAULT, ...JSON.parse(raw) } : CONFIG_DEFAULT;
  } catch { return CONFIG_DEFAULT; }
}
export function guardarConfig(cfg: ConfigConsejo): void {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* sin almacenamiento: se usa en memoria */ }
}
