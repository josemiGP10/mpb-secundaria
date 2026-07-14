// ============================================================
//  Sincronización local ↔ Supabase — Diario Pedagógico MPB
//
//  SUBIDA delta: solo registros modificados desde la última sync.
//  BAJADA delta: solo registros de Supabase más nuevos que la última sync.
//  Tablas catálogo (areas, asignaturas, grupos, etc.) siempre completas
//  porque son pocas filas y raramente cambian.
// ============================================================

import { supabase } from '@/lib/supabase';
import { db } from './database';

const SYNC_TS_KEY = 'mpb_sec_last_sync';
const BATCH       = 400;

// ── Resultado ──────────────────────────────────────────────

export interface SyncResult {
  ok: boolean; total: number; errores: string[]; ts: string;
}

const NO_CONFIG: SyncResult = {
  ok: false, total: 0, ts: new Date().toISOString(),
  errores: ['Supabase no configurado: faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel'],
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

// campo de fecha para filtrar delta (notas_cognitivas y registros_asistencia solo tienen created_at)
async function bajarDesde(tabla: string, desde: string | null, campo = 'updated_at'): Promise<unknown[]> {
  const todas: unknown[] = [];
  let offset = 0;
  const PG = 1000;
  while (true) {
    let query = supabase!.from(tabla).select('*').range(offset, offset + PG - 1);
    if (desde) query = query.gt(campo, desde);
    const { data, error } = await query;
    if (error) throw new Error(`[${tabla}] ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < PG) break;
    offset += PG;
  }
  return todas;
}

async function bajarSinFiltro(tabla: string): Promise<unknown[]> {
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

// ── Helpers de UI ──────────────────────────────────────────

export function getUltimaSync(): string | null {
  return localStorage.getItem(SYNC_TS_KEY);
}

// ══════════════════════════════════════════════════════════
//  SUBIDA: local → Supabase (delta desde última sync)
// ══════════════════════════════════════════════════════════

export async function sincronizarSubida(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;

  const errores: string[] = [];
  let total = 0;
  const ultimaSync = getUltimaSync();

  // Tablas catálogo: siempre completas (pocas filas, raramente cambian)
  const catalogo: [string, () => Promise<unknown[]>][] = [
    ['areas',             () => db.areas.toArray()],
    ['asignaturas',       () => db.asignaturas.toArray()],
    ['grupos',            () => db.grupos.toArray()],
    ['grupo_asignaturas', () => db.grupo_asignaturas.toArray()],
    ['estudiantes',       () => db.estudiantes.toArray()],
    ['matriculas',        () => db.matriculas.toArray()],
  ];

  // Tablas de trabajo: solo las modificadas desde la última sync
  const trabajo: [string, () => Promise<unknown[]>][] = ultimaSync ? [
    ['actividades_cognitivas', () => db.actividades_cognitivas.where('updated_at').above(ultimaSync).toArray()],
    ['calificaciones',         () => db.calificaciones.where('updated_at').above(ultimaSync).toArray()],
    ['notas_cognitivas',       () => db.notas_cognitivas.where('created_at').above(ultimaSync).toArray()],
    ['registros_asistencia',   () => db.registros_asistencia.where('created_at').above(ultimaSync).toArray()],
    ['secuencias',             () => db.secuencias.where('updated_at').above(ultimaSync).toArray()],
    ['sesiones',               () => db.sesiones.where('updated_at').above(ultimaSync).toArray()],
    ['registros_clase',        () => db.registros_clase.where('updated_at').above(ultimaSync).toArray()],
  ] : [
    ['actividades_cognitivas', () => db.actividades_cognitivas.toArray()],
    ['calificaciones',         () => db.calificaciones.toArray()],
    ['notas_cognitivas',       () => db.notas_cognitivas.toArray()],
    ['registros_asistencia',   () => db.registros_asistencia.toArray()],
    ['secuencias',             () => db.secuencias.toArray()],
    ['sesiones',               () => db.sesiones.toArray()],
    ['registros_clase',        () => db.registros_clase.toArray()],
  ];

  for (const [tabla, getter] of [...catalogo, ...trabajo]) {
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
//  BAJADA: Supabase → local (delta desde última sync)
// ══════════════════════════════════════════════════════════

export async function sincronizarBajada(): Promise<SyncResult> {
  if (!supabase) return NO_CONFIG;

  const errores: string[] = [];
  let total = 0;
  const ultimaSync = getUltimaSync();

  // Catálogo: siempre completo
  const catalogoPasos: [string, (r: unknown[]) => Promise<void>][] = [
    ['areas',             async (r) => { await db.areas.bulkPut(r as never); }],
    ['asignaturas',       async (r) => { await db.asignaturas.bulkPut(r as never); }],
    ['grupos',            async (r) => { await db.grupos.bulkPut(r as never); }],
    ['grupo_asignaturas', async (r) => { await db.grupo_asignaturas.bulkPut(r as never); }],
    ['estudiantes',       async (r) => { await db.estudiantes.bulkPut(r as never); }],
    ['matriculas',        async (r) => { await db.matriculas.bulkPut(r as never); }],
  ];

  // Tablas de trabajo: solo nuevas/modificadas en Supabase desde última sync
  // [tabla, putter, campoFecha?] — campoFecha por defecto 'updated_at'
  const trabajoPasos: [string, (r: unknown[]) => Promise<void>, string?][] = [
    ['actividades_cognitivas', async (r) => { await db.actividades_cognitivas.bulkPut(r as never); }],
    ['calificaciones',         async (r) => { await db.calificaciones.bulkPut(r as never); }],
    ['notas_cognitivas',       async (r) => { await db.notas_cognitivas.bulkPut(r as never); },     'created_at'],
    ['registros_asistencia',   async (r) => { await db.registros_asistencia.bulkPut(r as never); }, 'created_at'],
    ['secuencias',             async (r) => { await db.secuencias.bulkPut(r as never); }],
    ['sesiones',               async (r) => { await db.sesiones.bulkPut(r as never); }],
    ['registros_clase',        async (r) => { await db.registros_clase.bulkPut(r as never); }],
  ];

  for (const [tabla, putter] of catalogoPasos) {
    try {
      const rows = await bajarSinFiltro(tabla);
      await putter(rows);
      total += rows.length;
    } catch (e) {
      errores.push(String(e));
    }
  }

  for (const [tabla, putter, campo] of trabajoPasos) {
    try {
      const rows = await bajarDesde(tabla, ultimaSync, campo);
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
//  SYNC COMPLETO: subida + bajada
// ══════════════════════════════════════════════════════════

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