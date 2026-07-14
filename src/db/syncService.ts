// ============================================================
//  Sincronización local ↔ Supabase — Diario Pedagógico MPB
//
//  SUBIDA  (sincronizarSubida):  IndexedDB → Supabase
//  BAJADA  (sincronizarBajada):  Supabase  → IndexedDB
//
//  Estrategia: last-write-wins por updated_at / upsert por id.
//  El seed de grupos/estudiantes siempre viaja en la subida
//  para que un dispositivo nuevo reciba todo en la bajada.
// ============================================================

import { supabase } from '@/lib/supabase';
import { db } from './database';

const SYNC_TS_KEY = 'mpb_sec_last_sync';
const BATCH       = 400;

const NO_CONFIG: SyncResult = {
  ok: false, total: 0, ts: new Date().toISOString(),
  errores: ['Supabase no configurado: faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel'],
};

// ── Helpers ────────────────────────────────────────────────

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
  let desde = 0;
  const PG = 1000;
  while (true) {
    const { data, error } = await supabase!
      .from(tabla)
      .select('*')
      .range(desde, desde + PG - 1);
    if (error) throw new Error(`[${tabla}] ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < PG) break;
    desde += PG;
  }
  return todas;
}

// ── Resultado ──────────────────────────────────────────────

export interface SyncResult {
  ok: boolean; total: number; errores: string[]; ts: string;
}

// ══════════════════════════════════════════════════════════
//  SUBIDA: local → Supabase
// ══════════════════════════════════════════════════════════

export async function sincronizarSubida(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  // Orden: catálogo primero, luego datos de trabajo, luego secuencias
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
//  BAJADA: Supabase → local
//  Primer uso en un dispositivo nuevo: descarga todo.
// ══════════════════════════════════════════════════════════

export async function sincronizarBajada(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  const pasos: [string, (rows: unknown[]) => Promise<void>][] = [
    ['areas',                  async (r) => { await db.areas.bulkPut(r as never); }],
    ['asignaturas',            async (r) => { await db.asignaturas.bulkPut(r as never); }],
    ['grupos',                 async (r) => { await db.grupos.bulkPut(r as never); }],
    ['grupo_asignaturas',      async (r) => { await db.grupo_asignaturas.bulkPut(r as never); }],
    ['estudiantes',            async (r) => { await db.estudiantes.bulkPut(r as never); }],
    ['matriculas',             async (r) => { await db.matriculas.bulkPut(r as never); }],
    ['actividades_cognitivas', async (r) => { await db.actividades_cognitivas.bulkPut(r as never); }],
    ['calificaciones',         async (r) => { await db.calificaciones.bulkPut(r as never); }],
    ['notas_cognitivas',       async (r) => { await db.notas_cognitivas.bulkPut(r as never); }],
    ['registros_asistencia',   async (r) => { await db.registros_asistencia.bulkPut(r as never); }],
    ['secuencias',             async (r) => { await db.secuencias.bulkPut(r as never); }],
    ['sesiones',               async (r) => { await db.sesiones.bulkPut(r as never); }],
    ['registros_clase',        async (r) => { await db.registros_clase.bulkPut(r as never); }],
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

// ── Sync completo (subida + bajada) ────────────────────────
// Sube datos locales primero, luego baja todo lo de Supabase.
// Así cualquier dispositivo queda sincronizado con los demás.

export async function sincronizarCompleto(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;
  const errores: string[] = [];
  let total = 0;

  const subida = await sincronizarSubida();
  total += subida.total;
  errores.push(...subida.errores);

  const bajada = await sincronizarBajada();
  total += bajada.total;
  errores.push(...bajada.errores);

  const ts = new Date().toISOString();
  if (errores.length === 0) localStorage.setItem(SYNC_TS_KEY, ts);
  return { ok: errores.length === 0, total, errores, ts };
}

// ── Helpers de UI ──────────────────────────────────────────

export function getUltimaSync(): string | null {
  return localStorage.getItem(SYNC_TS_KEY);
}
