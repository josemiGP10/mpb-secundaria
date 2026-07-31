// ============================================================
//  Sincronización local ↔ Supabase — Diario Pedagógico MPB
//  Estrategia simple: subida y bajada completa siempre.
//  El upsert es idempotente — datos ya existentes se confirman rápido.
// ============================================================

import { supabase } from '@/lib/supabase';
import { db } from './database';

const SYNC_TS_KEY = 'mpb_sec_last_sync';
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

// Merge last-write-wins por updated_at: solo sobreescribe si el registro remoto
// es más nuevo que el local. Así un retiro/cambio local no se pisa en la bajada.
async function mergeConUpdatedAt(
  tabla: { bulkGet: (ids: string[]) => Promise<(Record<string, unknown> | undefined)[]>; bulkPut: (rows: Record<string, unknown>[]) => Promise<unknown> },
  remoteRows: Record<string, unknown>[],
): Promise<void> {
  if (remoteRows.length === 0) return;
  const ids = remoteRows.map(r => r.id as string);
  const locales = await tabla.bulkGet(ids);
  const aPoner: Record<string, unknown>[] = [];
  for (let i = 0; i < remoteRows.length; i++) {
    const remote = remoteRows[i];
    const local  = locales[i];
    if (!local) {
      aPoner.push(remote);
    } else {
      const tsLocal  = (local.updated_at  as string) ?? '';
      const tsRemote = (remote.updated_at as string) ?? '';
      if (tsRemote >= tsLocal) aPoner.push(remote);
    }
  }
  if (aPoner.length > 0) await tabla.bulkPut(aPoner as never);
}

export function getUltimaSync(): string | null {
  return localStorage.getItem(SYNC_TS_KEY);
}

// ══════════════════════════════════════════════════════════
//  SUBIDA: local → Supabase (completa)
// ══════════════════════════════════════════════════════════

export async function sincronizarSubida(): Promise<SyncResult> {
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
  if (errores.length === 0) localStorage.setItem(SYNC_TS_KEY, ts);
  return { ok: errores.length === 0, total, errores, ts };
}

// ══════════════════════════════════════════════════════════
//  BAJADA: Supabase → local (completa)
// ══════════════════════════════════════════════════════════

export async function sincronizarBajada(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  // Tablas con updated_at → merge last-write-wins (evita pisar cambios locales más nuevos)
  // Tablas sin updated_at (solo created_at) → bulkPut directo (son registros de solo inserción)
  const pasos: [string, (r: unknown[]) => Promise<void>][] = [
    ['areas',                  async (r) => { await mergeConUpdatedAt(db.areas         as never, r as never); }],
    ['asignaturas',            async (r) => { await mergeConUpdatedAt(db.asignaturas   as never, r as never); }],
    ['grupos',                 async (r) => { await mergeConUpdatedAt(db.grupos        as never, r as never); }],
    ['grupo_asignaturas',      async (r) => { await mergeConUpdatedAt(db.grupo_asignaturas as never, r as never); }],
    ['estudiantes',            async (r) => { await mergeConUpdatedAt(db.estudiantes   as never, r as never); }],
    ['matriculas',             async (r) => { await mergeConUpdatedAt(db.matriculas    as never, r as never); }],
    ['actividades_cognitivas', async (r) => { await mergeConUpdatedAt(db.actividades_cognitivas as never, r as never); }],
    ['calificaciones',         async (r) => { await mergeConUpdatedAt(db.calificaciones as never, r as never); }],
    ['notas_cognitivas',       async (r) => { await db.notas_cognitivas.bulkPut(r as never); }],
    ['registros_asistencia',   async (r) => { await db.registros_asistencia.bulkPut(r as never); }],
    ['secuencias',             async (r) => { await mergeConUpdatedAt(db.secuencias   as never, r as never); }],
    ['sesiones',               async (r) => { await mergeConUpdatedAt(db.sesiones     as never, r as never); }],
    ['registros_clase',        async (r) => { await mergeConUpdatedAt(db.registros_clase as never, r as never); }],
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

  const ts = new Date().toISOString();
  if (errores.length === 0) localStorage.setItem(SYNC_TS_KEY, ts);
  return { ok: errores.length === 0, total, errores, ts };
}

// ══════════════════════════════════════════════════════════
//  SYNC COMPLETO: BAJAR primero, luego SUBIR
//
//  Orden importa: si iPhone guardó 7.5 y PC tiene 5.0 por defecto,
//  bajar primero trae el 7.5 al PC; luego el PC sube el 7.5.
//  Si se subiera primero, el PC pisaría el 7.5 con su 5.0.
// ══════════════════════════════════════════════════════════

export async function sincronizarCompleto(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  // 1. Bajar primero: local queda con lo más reciente de Supabase
  const bajada = await sincronizarBajada();
  total += bajada.total;
  errores.push(...bajada.errores);

  // 2. Subir después: ya tenemos los datos correctos en local
  const subida = await sincronizarSubida();
  total += subida.total;
  errores.push(...subida.errores);

  const ts = new Date().toISOString();
  if (errores.length === 0) localStorage.setItem(SYNC_TS_KEY, ts);
  return { ok: errores.length === 0, total, errores, ts };
}