// ============================================================
//  GRUPOS Y AÑO ESCOLAR
//  Crear, editar y quitar los grupos de una vigencia, y copiar la
//  estructura del año anterior (mismos grupos y asignaturas, sin
//  estudiantes) para preparar el año siguiente aunque todavía no
//  se sepa cuántos salones habrá: se pueden agregar o quitar
//  grupos en cualquier momento.
// ============================================================

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/db/database';
import { useVigencia, cambiarVigencia, anioActual } from '@/lib/vigencia';
import type { Area, Asignatura, Grupo } from '@/db/types';

const GRADOS = [6, 7, 8, 9, 10, 11];
const LETRAS = ['A', 'B', 'C', 'D', 'E'];

function sortGrupos(gs: Grupo[]): Grupo[] {
  return [...gs].sort((a, b) => a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'));
}

/** Nombre sugerido con la convención de la app: "6A" o "MEF 6-7 A". */
function nombreSugerido(grado: number, mef: boolean, letra: string): string {
  return mef ? `MEF ${grado}-${grado + 1} ${letra}` : `${grado}${letra}`;
}

interface Borrador {
  id: string | null;          // null = grupo nuevo
  grado: number;
  mef: boolean;
  letra: string;
  nombre: string;
  asignaturas: Set<string>;
}

export function GruposView() {
  const anio = useVigencia();
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const grupos      = useLiveQuery(() => db.grupos.where('anio').equals(anio).toArray(), [anio]) ?? [];
  const anteriores  = useLiveQuery(() => db.grupos.where('anio').equals(anio - 1).toArray(), [anio]) ?? [];
  const asignaturas = useLiveQuery(() => db.asignaturas.toArray(), []) ?? [];
  const areas       = useLiveQuery(() => db.areas.toArray(), []) ?? [];
  const relaciones  = useLiveQuery(() => db.grupo_asignaturas.toArray(), []) ?? [];
  const conteos     = useLiveQuery(async () => {
    const mats = await db.matriculas.where('anio').equals(anio).toArray();
    const c = new Map<string, number>();
    for (const m of mats) if (m.activo !== false) c.set(m.grupo_id, (c.get(m.grupo_id) ?? 0) + 1);
    return c;
  }, [anio]) ?? new Map<string, number>();

  const asigPorArea = useMemo(() => {
    const m = new Map<Area | undefined, Asignatura[]>();
    for (const a of [...asignaturas].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))) {
      const area = areas.find(ar => ar.id === a.area_id);
      if (!m.has(area)) m.set(area, []);
      m.get(area)!.push(a);
    }
    return [...m.entries()].sort((x, y) => (x[0]?.nombre ?? '').localeCompare(y[0]?.nombre ?? '', 'es'));
  }, [asignaturas, areas]);

  const asigDeGrupo = (grupoId: string) => relaciones.filter(r => r.grupo_id === grupoId).map(r => r.asignatura_id);
  const nombreAsig = (id: string) => asignaturas.find(a => a.id === id)?.nombre ?? '—';

  /** Primera letra libre para ese grado y tipo (A si no hay ninguno). */
  const letraLibre = (grado: number, mef: boolean, excepto: string | null) => {
    const usadas = new Set(grupos.filter(g => g.id !== excepto).map(g => g.nombre.toLowerCase()));
    return LETRAS.find(l => !usadas.has(nombreSugerido(grado, mef, l).toLowerCase())) ?? 'A';
  };
  /** Al cambiar grado o tipo en un grupo nuevo, se recalcula letra y nombre. */
  const cambiarGradoTipo = (b: Borrador, grado: number, mef: boolean) => {
    const letra = b.id ? b.letra : letraLibre(grado, mef, null);
    setBorrador({ ...b, grado, mef, letra, nombre: nombreSugerido(grado, mef, letra) });
  };

  const nuevo = () => {
    const grado = 6;
    const letra = letraLibre(grado, false, null);
    setBorrador({ id: null, grado, mef: false, letra, nombre: nombreSugerido(grado, false, letra), asignaturas: new Set() });
  };

  const editar = (g: Grupo) => {
    const mef = g.num_periodos === 2 || /^MEF/i.test(g.nombre);
    const letra = (g.nombre.match(/([A-Z])\s*$/i)?.[1] ?? 'A').toUpperCase();
    setBorrador({ id: g.id, grado: g.grado_cod, mef, letra, nombre: g.nombre, asignaturas: new Set(asigDeGrupo(g.id)) });
  };

  const guardar = async () => {
    if (!borrador) return;
    const nombre = borrador.nombre.trim();
    if (!nombre) { setMsg('Escriba el nombre del grupo.'); return; }
    if (grupos.some(g => g.nombre.toLowerCase() === nombre.toLowerCase() && g.id !== borrador.id)) {
      setMsg(`Ya existe un grupo "${nombre}" en ${anio}.`); return;
    }
    const now = new Date().toISOString();
    const id = borrador.id ?? uuidv4();
    const previo = borrador.id ? await db.grupos.get(borrador.id) : undefined;
    await db.transaction('rw', db.grupos, db.grupo_asignaturas, async () => {
      await db.grupos.put({
        id, anio, nombre, grado_cod: borrador.grado, num_periodos: borrador.mef ? 2 : 4,
        created_at: previo?.created_at ?? now, updated_at: now,
      });
      // Asignaturas: se reemplaza la relación del grupo por la seleccionada
      const actuales = await db.grupo_asignaturas.where('grupo_id').equals(id).toArray();
      const quitar = actuales.filter(r => !borrador.asignaturas.has(r.asignatura_id)).map(r => r.id);
      const tener = new Set(actuales.map(r => r.asignatura_id));
      await db.grupo_asignaturas.bulkDelete(quitar);
      await db.grupo_asignaturas.bulkAdd([...borrador.asignaturas].filter(a => !tener.has(a)).map(a => ({
        id: uuidv4(), grupo_id: id, asignatura_id: a, created_at: now, updated_at: now,
      })));
    });
    setMsg(`✓ Grupo "${nombre}" guardado en ${anio}.`);
    setBorrador(null);
  };

  const eliminar = async (g: Grupo) => {
    const n = await db.matriculas.where('grupo_id').equals(g.id).count();
    if (n > 0) {
      alert(`"${g.nombre}" tiene ${n} matrícula(s) registradas. Para no perder notas ni asistencia, no se puede eliminar un grupo con estudiantes.`);
      return;
    }
    if (!confirm(`¿Eliminar el grupo "${g.nombre}" de ${anio}? No tiene estudiantes.`)) return;
    await db.transaction('rw', db.grupos, db.grupo_asignaturas, async () => {
      await db.grupo_asignaturas.where('grupo_id').equals(g.id).delete();
      await db.grupos.delete(g.id);
    });
    setMsg(`Grupo "${g.nombre}" eliminado.`);
  };

  const copiarAnterior = async () => {
    const existentes = new Set(grupos.map(g => g.nombre.toLowerCase()));
    const aCopiar = anteriores.filter(g => !existentes.has(g.nombre.toLowerCase()));
    if (aCopiar.length === 0) { setMsg(`Todos los grupos de ${anio - 1} ya existen en ${anio}.`); return; }
    if (!confirm(`Crear en ${anio} los ${aCopiar.length} grupos de ${anio - 1} (${aCopiar.map(g => g.nombre).join(', ')}) con sus mismas asignaturas y SIN estudiantes?\n\nDespués puede renombrar, quitar o agregar grupos.`)) return;
    const now = new Date().toISOString();
    await db.transaction('rw', db.grupos, db.grupo_asignaturas, async () => {
      for (const g of aCopiar) {
        const id = uuidv4();
        await db.grupos.add({ id, anio, nombre: g.nombre, grado_cod: g.grado_cod, num_periodos: g.num_periodos, created_at: now, updated_at: now });
        await db.grupo_asignaturas.bulkAdd(asigDeGrupo(g.id).map(a => ({ id: uuidv4(), grupo_id: id, asignatura_id: a, created_at: now, updated_at: now })));
      }
    });
    setMsg(`✓ ${aCopiar.length} grupos copiados de ${anio - 1} a ${anio}, sin estudiantes.`);
  };

  const actual = anioActual();

  return (
    <div className="p-4 flex flex-col gap-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Grupos y año escolar</h2>
        <p className="text-xs text-slate-500">
          Está trabajando en la vigencia <b>{anio}</b>
          {anio !== actual && <> (el año actual es {actual})</>}. Toda la app — asistencia, notas, secuencias, reportes —
          muestra los grupos de esta vigencia. Puede cambiarla aquí o en el encabezado.
        </p>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {[actual - 1, actual, actual + 1].map(a => (
            <button key={a} onClick={() => cambiarVigencia(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${a === anio ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {a}{a === actual ? ' (actual)' : a === actual + 1 ? ' (próximo)' : ''}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="text-xs rounded-lg bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2">{msg}</p>}

      <div className="flex gap-2 flex-wrap">
        <button onClick={nuevo} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow hover:bg-blue-700">+ Nuevo grupo</button>
        {anteriores.length > 0 && (
          <button onClick={copiarAnterior}
            className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50">
            ⧉ Copiar grupos de {anio - 1} ({anteriores.length}) sin estudiantes
          </button>
        )}
      </div>

      {borrador && (
        <div className="rounded-2xl bg-white border border-blue-300 p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-800">{borrador.id ? 'Editar grupo' : `Nuevo grupo para ${anio}`}</h3>
          <div className="flex gap-3 flex-wrap items-end text-xs text-slate-700">
            <label className="flex flex-col gap-1">Grado
              <select value={borrador.grado}
                onChange={e => cambiarGradoTipo(borrador, Number(e.target.value), borrador.mef)}
                className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5">
                {GRADOS.map(g => <option key={g} value={g}>{g}°</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Tipo
              <select value={borrador.mef ? 'MEF' : 'REG'}
                onChange={e => cambiarGradoTipo(borrador, borrador.grado, e.target.value === 'MEF')}
                className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5">
                <option value="REG">Regular (4 períodos)</option>
                <option value="MEF">MEF (2 semestres)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">Letra
              <select value={borrador.letra}
                onChange={e => setBorrador({ ...borrador, letra: e.target.value, nombre: nombreSugerido(borrador.grado, borrador.mef, e.target.value) })}
                className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5">
                {LETRAS.map(l => <option key={l}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">Nombre (se puede cambiar)
              <input value={borrador.nombre} onChange={e => setBorrador({ ...borrador, nombre: e.target.value })}
                className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5" />
            </label>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1">Asignaturas que usted dicta en este grupo</p>
            <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-slate-100 rounded-lg p-2">
              {asigPorArea.map(([area, lista]) => (
                <div key={area?.id ?? 'sin-area'}>
                  <p className="text-[10px] uppercase text-slate-400">{area?.nombre ?? 'Sin área'}</p>
                  {lista.map(a => (
                    <label key={a.id} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input type="checkbox" checked={borrador.asignaturas.has(a.id)}
                        onChange={e => {
                          const s = new Set(borrador.asignaturas);
                          if (e.target.checked) s.add(a.id); else s.delete(a.id);
                          setBorrador({ ...borrador, asignaturas: s });
                        }} />
                      {a.nombre}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={guardar} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold">Guardar</button>
            <button onClick={() => setBorrador(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs">Cancelar</button>
          </div>
        </div>
      )}

      {grupos.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No hay grupos creados para {anio}.
          {anteriores.length > 0
            ? <> Puede copiarlos de {anio - 1} con el botón de arriba y luego ajustar, o crearlos uno por uno.</>
            : <> Créelos con "+ Nuevo grupo".</>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sortGrupos(grupos).map(g => (
            <div key={g.id} className="rounded-xl bg-white border border-slate-200 px-3 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-slate-800 w-28">{g.nombre}</span>
              <span className="text-[11px] text-slate-500">{g.grado_cod}° · {g.num_periodos === 2 ? '2 semestres' : '4 períodos'}</span>
              <span className="text-[11px] text-slate-500">{conteos.get(g.id) ?? 0} estudiantes</span>
              <span className="text-[11px] text-slate-400 flex-1 min-w-[160px]">
                {asigDeGrupo(g.id).map(nombreAsig).join(' · ') || 'sin asignaturas'}
              </span>
              <button onClick={() => editar(g)} className="text-xs text-blue-700 hover:underline">Editar</button>
              <button onClick={() => eliminar(g)} className="text-xs text-red-700 hover:underline">Eliminar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
