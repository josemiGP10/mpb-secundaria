// ============================================================
//  Respaldo con Supabase — Diario Pedagógico MPB
//  La app funciona 100% local (IndexedDB) en este equipo. Supabase
//  solo se usa para: (a) importar una vez al arrancar en un equipo
//  sin datos locales, y (b) respaldar manualmente cuando el docente
//  lo pida, con buena conexión. Sin sincronización automática ni
//  periódica — un solo equipo, un solo dueño de los datos: local.
// ============================================================

import { supabase } from '@/lib/supabase';
import { db } from './database';

const BACKUP_TS_KEY = 'mpb_sec_last_backup';
const BATCH = 400;

// ── Resultado ──────────────────────────────────────────────

export interface SyncResult {
  ok: boolean; total: number; errores: string[]; ts: string;
}

const NO_CONFIG: SyncResult = {
  ok: false, total: 0, ts: new Date().toISOString(),
  errores: ['Supabase no configurado'],
};

// ── Helpers de red ─────────────────────────────────────────

async function subirTabla(tabla: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase!
      .from(tabla)
      .upsert(rows.slice(i, i + BATCH) as object[], { onConflict: 'id' });
    if (error) throw new Error(`[${tabla}] ${error.message}`);
  }
}

async function bajarTabla(tabla: string): Promise<unknown[]> {
  const todas: unknown[] = [];
  let offset = 0;
  const PG = 1000;
  while (true) {
    const { data, error } = await supabase!
      .from(tabla).select('*').range(offset, offset + PG - 1);
    if (error) throw new Error(`[${tabla}] ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < PG) break;
    offset += PG;
  }
  return todas;
}

export function getUltimoRespaldo(): string | null {
  return localStorage.getItem(BACKUP_TS_KEY);
}

// ══════════════════════════════════════════════════════════
//  IMPORTAR: Supabase → local. Solo se llama una vez, cuando
//  este equipo arranca sin datos locales todavía.
// ══════════════════════════════════════════════════════════

export async function importarDesdeSupabase(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  const pasos: [string, (rows: unknown[]) => Promise<unknown>][] = [
    ['areas',                  (r) => db.areas.bulkPut(r as never)],
    ['asignaturas',            (r) => db.asignaturas.bulkPut(r as never)],
    ['grupos',                 (r) => db.grupos.bulkPut(r as never)],
    ['grupo_asignaturas',      (r) => db.grupo_asignaturas.bulkPut(r as never)],
    ['estudiantes',            (r) => db.estudiantes.bulkPut(r as never)],
    ['matriculas',             (r) => db.matriculas.bulkPut(r as never)],
    ['actividades_cognitivas', (r) => db.actividades_cognitivas.bulkPut(r as never)],
    ['calificaciones',         (r) => db.calificaciones.bulkPut(r as never)],
    ['notas_cognitivas',       (r) => db.notas_cognitivas.bulkPut(r as never)],
    ['registros_asistencia',   (r) => db.registros_asistencia.bulkPut(r as never)],
    ['secuencias',             (r) => db.secuencias.bulkPut(r as never)],
    ['sesiones',               (r) => db.sesiones.bulkPut(r as never)],
    ['registros_clase',        (r) => db.registros_clase.bulkPut(r as never)],
  ];

  for (const [tabla, putter] of pasos) {
    try {
      const rows = await bajarTabla(tabla);
      await putter(rows);
      total += rows.length;
    } catch (e) {
      errores.push(String(e));
    }
  }

  return { ok: errores.length === 0, total, errores, ts: new Date().toISOString() };
}

// ══════════════════════════════════════════════════════════
//  RESPALDAR: local → Supabase. Botón manual "Respaldar ahora".
// ══════════════════════════════════════════════════════════

export async function respaldarASupabase(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  const pasos: [string, () => Promise<unknown[]>][] = [
    ['areas',                  () => db.areas.toArray()],
    ['asignaturas',            () => db.asignaturas.toArray()],
    ['grupos',                 () => db.grupos.toArray()],
    ['grupo_asignaturas',      () => db.grupo_asignaturas.toArray()],
    ['estudiantes',            () => db.estudiantes.toArray()],
    ['matriculas',             () => db.matriculas.toArray()],
    ['actividades_cognitivas', () => db.actividades_cognitivas.toArray()],
    ['calificaciones',         () => db.calificaciones.toArray()],
    ['notas_cognitivas',       () => db.notas_cognitivas.toArray()],
    ['registros_asistencia',   () => db.registros_asistencia.toArray()],
    ['secuencias',             () => db.secuencias.toArray()],
    ['sesiones',               () => db.sesiones.toArray()],
    ['registros_clase',        () => db.registros_clase.toArray()],
  ];

  for (const [tabla, getter] of pasos) {
    try {
      const rows = await getter();
      await subirTabla(tabla, rows);
      total += rows.length;
    } catch (e) {
      errores.push(String(e));
    }
  }

  const ts = new Date().toISOString();
  if (errores.length === 0) localStorage.setItem(BACKUP_TS_KEY, ts);
  return { ok: errores.length === 0, total, errores, ts };
}
