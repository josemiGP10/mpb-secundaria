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
  /** Períodos que usa el grupo: 4 regulares, 2 (semestres) en MEF y
   *  Aceleración. Se deduce de qué períodos traen notas. */
  numPeriodos?: number;
  areas: string[];
  asignaturas: string[];
  estudiantes: EstudianteConsejo[];
}

export const periodosDe = (g: GrupoConsejo): Corte[] => PERIODOS.slice(0, g.numPeriodos ?? 4);

export interface ImportConsejo {
  id: 'actual';
  importado_at: string;
  archivo_areas: string;
  archivo_asignaturas: string | null;
  grupos: GrupoConsejo[];
}

// 'DESERTADO' existió como decisión aparte; ahora desertado y retirado son
// una sola categoría ('RETIRADO'). Se conserva en el tipo solo para leer
// decisiones guardadas antes del cambio (ver normalizarDecision).
export type Decision =
  | 'PENDIENTE' | 'PROMOVIDO' | 'RECUPERACION' | 'RECUPERO' | 'NO_PROMOVIDO' | 'DESERTADO' | 'RETIRADO';
export const normalizarDecision = (d: Decision): Decision => (d === 'DESERTADO' ? 'RETIRADO' : d);

export const DECISIONES: { id: Decision; label: string; color: string }[] = [
  { id: 'PENDIENTE',    label: 'Pendiente',                     color: 'bg-slate-100 text-slate-600' },
  { id: 'PROMOVIDO',    label: 'Promovido',                     color: 'bg-emerald-100 text-emerald-800' },
  { id: 'RECUPERACION', label: 'Va a recuperación',             color: 'bg-amber-100 text-amber-800' },
  { id: 'RECUPERO',     label: 'Recuperó → promovido',          color: 'bg-teal-100 text-teal-800' },
  { id: 'NO_PROMOVIDO', label: 'No promovido (repite el año)',  color: 'bg-red-100 text-red-800' },
  { id: 'RETIRADO',     label: 'Desertado / retirado',          color: 'bg-yellow-200 text-yellow-900' },
];
export const labelDecision = (d: Decision) => DECISIONES.find(x => x.id === normalizarDecision(d))?.label ?? d;

/** Estado con las categorías del listado institucional (el que entregó
 *  primaria). Desertado y retirado van juntos en una sola categoría. */
export type EstadoInstitucional = 'APROBADO' | 'CURSANDO' | 'REPROBADO' | 'RETIRADO';
export const TEXTO_ESTADO: Record<EstadoInstitucional, string> = {
  APROBADO: 'APROBADO', CURSANDO: 'CURSANDO', REPROBADO: 'REPROBADO', RETIRADO: 'DESERTADO/RETIRADO',
};
export function estadoInstitucional(d: Decision): EstadoInstitucional {
  switch (normalizarDecision(d)) {
    case 'PROMOVIDO': case 'RECUPERO': return 'APROBADO';
    case 'NO_PROMOVIDO': return 'REPROBADO';
    case 'RETIRADO': return 'RETIRADO';
    default: return 'CURSANDO';   // va a recuperación o aún pendiente
  }
}

export interface DecisionConsejo {
  id: string;           // `${corte}|${grupo}|${nombre}`
  corte: Corte;
  grupo: string;
  nombre: string;
  decision: Decision;
  observacion: string;
  /** Áreas que el consejo decidió que va a recuperar. Si no existe, se
   *  asumen todas las áreas perdidas. */
  areas_recuperar?: string[];
  /** Nota obtenida en la recuperación, por área. */
  notas_recuperacion?: Record<string, number>;
  updated_at: string;
}

/** Decisiones en las que aplica escoger áreas a recuperar. */
export const conRecuperacion = (d: Decision) => d === 'RECUPERACION' || d === 'RECUPERO';

export function areasARecuperar(perdidas: { area: string }[], guardada?: DecisionConsejo): string[] {
  const perd = perdidas.map(p => p.area);
  return guardada?.areas_recuperar ? perd.filter(a => guardada.areas_recuperar!.includes(a)) : perd;
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
  MOT:    'Ejes Movilizadores',
  RU:     'Ética y Religión',
  SOC:    'Ciencias Sociales',
};
export const nombreArea = (c: string) => NOMBRE_AREA[c] ?? c;

// Nombres de las asignaturas según la asignación académica, el plan de
// estudios y el listado de notas pendientes de primaria. Las que no se
// pudieron confirmar se muestran con el código de la plataforma.
export const NOMBRE_ASIGNATURA: Record<string, string> = {
  NAT: 'Ciencias Naturales', PFQ: 'Proceso Físico-Químico', BIOLO: 'Biología', FISIC: 'Física',
  QUIM: 'Química', QUYBI: 'Química y Biología',
  ART: 'Artística', ART1: 'Artística', EMPR: 'Emprendimiento', EFIS: 'Educación Física',
  'C TEX': 'Comprensión y Creación de Texto', 'OR CA': 'Ortografía', 'L CAS': 'Lengua Castellana', LCAST: 'Lengua Castellana',
  'L EXT': 'Inglés', LEXTR: 'Inglés', LCRIT: 'Lectura Crítica',
  'I Y T': 'Informática y Tecnología',
  MAT: 'Matemáticas', RESPR: 'Resolución de Problemas', 'E Y G': 'Estadística y Geometría',
  GEOM: 'Geometría', EST: 'Estadística',
  E2: 'Eje Deporte y Recreación', ECIYT: 'Eje Ciencia y Tecnología', ECLUB: 'Eje Club de Lectura',
  EJARY: 'Eje Arte y Cultura', EJTUR: 'Eje Turismo', Ej: 'Eje Movilizador',
  AFROC: 'Afrocolombianidad', ERyP: 'Ética y Religión', Raice: 'Raíces',
  SOC: 'Ciencias Sociales', CCIU: 'Competencias Ciudadanas', GEOG: 'Geografía', HIST: 'Historia',
  CYECO: 'Ciencias Económicas y Políticas', FIL: 'Filosofía', PPP: 'Proyecto Pedagógico Productivo',
};
export const nombreAsignatura = (c: string) => NOMBRE_ASIGNATURA[c] ?? c;

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
  // MEF y Aceleración
  PPP: ['SOC'], QUYBI: ['CNAT'], Raice: ['RU'],
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
  // La plataforma exporta "MEF 6�-7� A Unica" (el símbolo de grado llega dañado)
  if (/^mef/i.test(limpio)) {
    const nums = limpio.match(/\d+/g) ?? [];
    return { nombre: `MEF ${nums.join('-')}`, grado: 20 + Number(nums[0] ?? 0) };
  }
  if (/^aceleraci/i.test(limpio)) return { nombre: 'Aceleración', grado: 5 };
  for (const [re, g] of GRADOS) {
    if (re.test(limpio)) {
      const letra = limpio.split(' ')[1] ?? '';
      return { nombre: `${g}° ${/^[A-Z]$/i.test(letra) ? letra.toUpperCase() : ''}`.trim(), grado: g };
    }
  }
  return { nombre: limpio, grado: 99 };
}

const normNombre = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Nombre comparable entre la plataforma y el diario: sin tildes, en
 *  mayúscula y sin espacios dobles. La plataforma exporta la Ñ y las
 *  tildes dañadas (carácter �); esas posiciones quedan como "?" y se
 *  tratan como comodín al comparar. */
// Marcas de tilde (U+0300 a U+036F) y caracter de reemplazo U+FFFD, armados
// con codigos para no depender de como se guarden esos simbolos en el archivo.
const SIN_TILDES = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const CARACTER_DANADO = new RegExp(String.fromCharCode(0xfffd), 'g');

export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(SIN_TILDES, '').replace(CARACTER_DANADO, '?')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

export interface IndiceDiario {
  conjunto: Set<string>;     // todos los nombres del diario (normalizados)
  lista: string[];
  retirados: Set<string>;    // nombres de estudiantes retirados
}

/** Índice de estudiantes del diario con su estado, con la MISMA regla de
 *  la lista de asistencia: dentro de un grupo, si hay copias duplicadas y
 *  alguna está retirada, el estudiante está retirado de ese grupo. Solo
 *  cuenta como retirado si lo está en TODOS sus grupos (si pasó de 7° a
 *  MEF y sigue activo allá, no está retirado). */
export function construirIndiceDiario(
  matriculas: { estudiante_id: string; grupo_id: string; activo: boolean }[],
  estudiantes: Map<string, { tipo_doc: string; doc: string; apellido1: string; apellido2: string; nombre1: string; nombre2: string }>,
): IndiceDiario {
  const porDoc = new Map<string, { nombres: Set<string>; grupos: Map<string, boolean> }>();
  for (const m of matriculas) {
    const e = estudiantes.get(m.estudiante_id);
    if (!e) continue;
    const doc = `${e.tipo_doc}-${String(e.doc).replace(/_mef$/i, '')}`;
    if (!porDoc.has(doc)) porDoc.set(doc, { nombres: new Set(), grupos: new Map() });
    const x = porDoc.get(doc)!;
    x.nombres.add(normalizarNombre([e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ')));
    x.grupos.set(m.grupo_id, (x.grupos.get(m.grupo_id) ?? false) || m.activo === false);
  }
  const conjunto = new Set<string>(), retirados = new Set<string>(), activos = new Set<string>();
  for (const { nombres, grupos } of porDoc.values()) {
    const retirado = [...grupos.values()].every(Boolean);
    for (const n of nombres) { conjunto.add(n); (retirado ? retirados : activos).add(n); }
  }
  // Un mismo nombre con un documento activo y otro retirado: se toma activo
  for (const n of activos) retirados.delete(n);
  return { conjunto, lista: [...conjunto], retirados };
}

/** Distancia de edición entre dos nombres; "?" (letra dañada) no cuenta. */
function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const igual = a[i - 1] === b[j - 1] || a[i - 1] === '?' || b[j - 1] === '?';
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (igual ? 0 : 1));
      if (cur[j] < minFila) minFila = cur[j];
    }
    if (minFila > tope) return tope + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Busca el nombre de la plataforma entre los nombres del diario (ya
 *  normalizados). Primero exacto; si no, tolera hasta 2 letras de
 *  diferencia (errores de digitación entre plataforma y diario), siempre
 *  que coincida el primer apellido. Devuelve el nombre del diario o null. */
export function buscarEnDiario(nombrePlataforma: string, conjunto: Set<string>, lista: string[]): string | null {
  const n = normalizarNombre(nombrePlataforma);
  if (conjunto.has(n)) return n;
  const tokens = n.split(' ');
  const ap = tokens[0];
  let mejor: string | null = null, mejorD = 3;
  for (const x of lista) {
    // El primer apellido debe coincidir (se tolera 1 letra: OSORIO/OSORIOS)
    if (distancia(x.split(' ')[0], ap, 1) > 1) continue;
    const d = distancia(n, x, 2);
    if (d < mejorD) { mejor = x; mejorD = d; if (d === 0) break; }
  }
  if (mejor) return mejor;

  // Un nombre contenido en el otro: le falta o le sobra un nombre
  // ("RODRIGUEZ ALTAMAR RICARDO" ⊂ "RODRIGUEZ ALTAMAR RICARDO EDUARDO") o
  // viene en otro orden ("JOSE FRANCISCO PINEDA PEREZ"). Se exigen al menos
  // 3 palabras en común y que sea el único candidato, para no confundir hermanos.
  const set = new Set(tokens);
  const candidatos = lista.filter(x => {
    const tx = x.split(' ');
    const [corto, largo] = tx.length <= set.size ? [tx, set] : [tokens, new Set(tx)];
    return corto.length >= 3 && corto.every(t => largo.has(t));
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}
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

/** Carga un par de consolidados. Por defecto los grupos se AGREGAN a los
 *  ya cargados (los regulares y los MEF vienen en archivos distintos);
 *  un grupo que ya existía se reemplaza por la versión nueva. */
export async function importarConsolidados(
  fileAreas: File, fileAsig: File | null, reemplazarTodo = false,
): Promise<ImportConsejo> {
  const areas = parsearConsolidado(await leerPrimeraHoja(fileAreas));
  if (areas.length === 0) throw new Error('No se encontraron grupos en el consolidado de áreas. ¿Es el archivo correcto?');
  const asigs = fileAsig ? parsearConsolidado(await leerPrimeraHoja(fileAsig)) : [];
  if (fileAsig && asigs.length === 0) throw new Error('No se encontraron grupos en el consolidado de asignaturas.');

  const grupos: GrupoConsejo[] = areas.map(ga => {
    const gs = asigs.find(x => x.clave === ga.clave);
    const { nombre, grado } = nombreGrupo(ga.clave);
    // Último período con alguna nota en el grupo (MEF/Aceleración = 2 semestres)
    let numPeriodos = 0;
    PERIODOS.forEach((p, i) => {
      if ([...ga.est.values()].some(n => Object.values(n[p] ?? {}).some(v => v != null))) numPeriodos = i + 1;
    });
    return {
      clave: ga.clave, nombre, grado, numPeriodos: numPeriodos || 4,
      areas: ga.cols,
      asignaturas: gs?.cols ?? [],
      estudiantes: [...ga.est.entries()].map(([n, notas]) => ({
        nombre: n, areas: notas, asignaturas: gs?.est.get(n),
      })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  });

  const previo = reemplazarTodo ? undefined : await db.consejo_import.get('actual');
  const nuevas = new Set(grupos.map(g => g.clave));
  const todos = [...(previo?.grupos ?? []).filter(g => !nuevas.has(g.clave)), ...grupos]
    .sort((a, b) => a.grado - b.grado || a.nombre.localeCompare(b.nombre, 'es'));

  const data: ImportConsejo = {
    id: 'actual',
    importado_at: new Date().toISOString(),
    archivo_areas: fileAreas.name,
    archivo_asignaturas: fileAsig?.name ?? null,
    grupos: todos,
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
    const incompleta = corte === 'FINAL' && periodosDe(grupo).some(p => e.areas[p]?.[a] == null);
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
    for (const p of periodosDe(grupo)) {
      const faltan = grupo.estudiantes.filter(e => e.areas[p]?.[a] == null).length;
      if (n > 0 && faltan / n >= 0.5) res.push({ area: a, periodo: p, faltan });
    }
  }
  return res;
}

/** Áreas que el docente SÍ calificó en el último período del grupo (al
 *  menos la mitad del grupo tiene nota mayor que 0). Sirve para no
 *  confundir "el docente no ha subido notas" con "el estudiante no vino". */
export function areasCalificadasUltimoPeriodo(grupo: GrupoConsejo): { periodo: Corte; areas: string[] } {
  const per = periodosDe(grupo);
  const ult = per[per.length - 1];
  const n = grupo.estudiantes.length;
  const areas = grupo.areas.filter(a =>
    grupo.estudiantes.filter(e => (e.areas[ult]?.[a] ?? 0) > 0).length >= n * 0.5);
  return { periodo: ult, areas };
}

/** Posible desertor: en el último período no tiene nota (o tiene 0) en la
 *  mitad o más de las áreas que el docente sí calificó al resto del grupo. */
export function esPosibleDesertor(e: EstudianteConsejo, ult: { periodo: Corte; areas: string[] }): boolean {
  if (ult.areas.length === 0) return false;
  const vacias = ult.areas.filter(a => (e.areas[ult.periodo]?.[a] ?? 0) <= 0).length;
  return vacias >= ult.areas.length * 0.5;
}

export function decisionSugerida(a: Analisis, corte: Corte, cfg: ConfigConsejo, desertor = false): Decision {
  if (a.sinNingunaNota || desertor) return 'RETIRADO';
  if (a.perdidas.length === 0) return 'PROMOVIDO';
  if (corte === 'FINAL' && a.perdidas.length >= cfg.areasParaReprobar) return 'NO_PROMOVIDO';
  return 'RECUPERACION';
}

export const idDecision = (corte: Corte, grupo: string, nombre: string) => `${corte}|${grupo}|${nombre}`;

export async function guardarDecision(
  corte: Corte, grupo: string, nombre: string,
  cambios: Partial<Pick<DecisionConsejo, 'decision' | 'observacion' | 'areas_recuperar' | 'notas_recuperacion'>>,
): Promise<void> {
  const id = idDecision(corte, grupo, nombre);
  const prev = await db.consejo_decisiones.get(id);
  await db.consejo_decisiones.put({
    id, corte, grupo, nombre,
    decision: cambios.decision ?? prev?.decision ?? 'PENDIENTE',
    observacion: cambios.observacion ?? prev?.observacion ?? '',
    areas_recuperar: cambios.areas_recuperar ?? prev?.areas_recuperar,
    notas_recuperacion: cambios.notas_recuperacion ?? prev?.notas_recuperacion,
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
