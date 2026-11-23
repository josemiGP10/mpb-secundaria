// Panel "Importar carga": lee el archivo de Horarios MPB, el docente
// elige su nombre, ve lo que se va a hacer y lo confirma.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { aplicar, leerArchivoCarga, normalizar, planificar, type ArchivoCarga, type PlanImportacion } from './importarCarga';

const CLAVE_DOCENTE = 'mpb_sec_docente_carga';
const leerLS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const guardarLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

export function ImportarCargaPanel({ anio, onCerrar, onListo }: { anio: number; onCerrar: () => void; onListo: (msg: string) => void }) {
  const [archivo, setArchivo] = useState<ArchivoCarga | null>(null);
  const [docente, setDocente] = useState('');
  const [plan, setPlan] = useState<PlanImportacion | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const asignaturas = useLiveQuery(() => db.asignaturas.toArray().then(xs => xs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))), []) ?? [];

  const cambiarEquivalencia = async (nombre: string, id: string) => {
    if (!archivo || !plan) return;
    try { setPlan(await planificar(archivo, docente, anio, { ...plan.equivalencias, [normalizar(nombre)]: id })); }
    catch (e) { setError((e as Error).message); }
  };

  const elegirDocente = async (a: ArchivoCarga, nombre: string) => {
    setDocente(nombre); setPlan(null); setQuitar(false);
    if (!nombre) return;
    guardarLS(CLAVE_DOCENTE, nombre);
    try { setPlan(await planificar(a, nombre, anio)); } catch (e) { setError((e as Error).message); }
  };

  const abrir = async (f: File | undefined) => {
    setError(null); setPlan(null); setArchivo(null); setDocente('');
    if (!f) return;
    try {
      const a = leerArchivoCarga(await f.text());
      setArchivo(a);
      const recordado = leerLS(CLAVE_DOCENTE);
      if (recordado && a.docentes.some(d => d.nombre === recordado)) await elegirDocente(a, recordado);
    } catch (e) { setError((e as Error).message); }
  };

  const confirmar = async () => {
    if (!plan) return;
    setTrabajando(true);
    try { onListo(await aplicar(plan, anio, quitar)); } catch (e) { setError('No se pudo importar: ' + (e as Error).message); }
    setTrabajando(false);
  };

  const horas = archivo?.docentes.find(d => d.nombre === docente)?.cargas.reduce((s, c) => s + c.horasSemana, 0) ?? 0;
  const nuevos = plan?.vinculos.filter(v => v.nuevo).length ?? 0;
  const hayCambios = !!plan && (plan.gruposNuevos.length + plan.asignaturasNuevas.filter(a => !a.usar).length + nuevos > 0 || (quitar && plan.sobrantes.length > 0));

  return (
    <div className="rounded-2xl bg-white border border-emerald-300 p-4 flex flex-col gap-3 text-xs text-slate-700">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-800">Importar carga académica</h3>
          <p className="text-slate-500">
            Use el archivo "Carga académica AAAA.json" que se descarga en Horarios MPB → Exportar. Se crean sus grupos y sus
            asignaturas en {anio}. No se borran notas, asistencia ni estudiantes.
          </p>
        </div>
        <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700 text-base leading-none" aria-label="Cerrar">✕</button>
      </div>

      <input type="file" accept=".json,application/json" onChange={e => void abrir(e.target.files?.[0])}
        className="text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-emerald-600 file:text-white file:font-semibold" />

      {error && <p className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-3 py-2">{error}</p>}

      {archivo && (
        <>
          {archivo.anio !== anio && (
            <p className="rounded-lg bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2">
              ⚠ El archivo es del horario <b>{archivo.anio}</b> y usted está trabajando en la vigencia <b>{anio}</b>.
              Si lo importa, la carga quedará en {anio}. Para ponerla en {archivo.anio}, cambie primero la vigencia arriba.
            </p>
          )}
          <label className="flex flex-col gap-1 max-w-xs">¿Quién es usted?
            <select value={docente} onChange={e => void elegirDocente(archivo, e.target.value)}
              className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5">
              <option value="">— Elija su nombre —</option>
              {[...archivo.docentes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(d => <option key={d.nombre} value={d.nombre}>{d.nombre}</option>)}
            </select>
          </label>
        </>
      )}

      {plan && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold text-slate-800">Esto es lo que se va a hacer ({horas} horas semanales en la carga):</p>

          {plan.gruposNuevos.length > 0 && (
            <div><p className="font-semibold text-emerald-700">Grupos nuevos en {anio} ({plan.gruposNuevos.length})</p>
              <p>{plan.gruposNuevos.map(g => `${g.nombre}${g.nombre !== g.desde ? ` (${g.desde})` : ''}${g.mef ? ' · 2 semestres' : ''}`).join(' · ')}</p></div>
          )}
          {plan.gruposExistentes.length > 0 && (
            <div><p className="font-semibold text-slate-600">Grupos que ya existen ({plan.gruposExistentes.length})</p>
              <p>{plan.gruposExistentes.map(g => g.grupo.nombre + (g.grupo.nombre.toLowerCase() !== g.desde.toLowerCase() ? ` (${g.desde})` : '')).join(' · ')}</p></div>
          )}
          {plan.asignaturasNuevas.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-emerald-700">Asignaturas con otro nombre en el horario ({plan.asignaturasNuevas.length})</p>
              <p className="text-slate-500">Si ya tiene la asignatura en el Diario con otro nombre, elíjala para que se conserven sus notas; si no, se crea nueva.</p>
              {plan.asignaturasNuevas.map(a => (
                <label key={a.nombre} className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold min-w-[180px]">{a.nombre}</span>
                  <span className="text-slate-400">→</span>
                  <select value={a.usar} onChange={e => void cambiarEquivalencia(a.nombre, e.target.value)}
                    className="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1">
                    <option value="">Crear nueva (área: {a.area}{a.areaNueva ? ', nueva' : ''})</option>
                    {asignaturas.map(x => <option key={x.id} value={x.id}>Es la misma que: {x.nombre}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="text-left px-2 py-1">Grupo</th><th className="text-left px-2 py-1">Asignatura</th><th className="px-2 py-1">h/sem</th><th className="px-2 py-1"></th></tr></thead>
              <tbody>
                {plan.vinculos.map(v => (
                  <tr key={v.grupo + v.asignatura} className="border-t border-slate-100">
                    <td className="px-2 py-1 font-semibold">{v.grupo}</td><td className="px-2 py-1">{v.asignatura}</td>
                    <td className="px-2 py-1 text-center">{v.horas}</td>
                    <td className="px-2 py-1 text-center">{v.nuevo ? <span className="text-emerald-700 font-semibold">+ nueva</span> : <span className="text-slate-400">ya está</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.omitidos.length > 0 && (
            <p className="text-slate-500">No se importan: {plan.omitidos.map(o => `${o.grupo} (${o.motivo})`).join(', ')}.</p>
          )}

          {plan.sobrantes.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <input type="checkbox" checked={quitar} onChange={e => setQuitar(e.target.checked)} className="mt-0.5" />
              <span>
                Quitar de sus grupos lo que ya no está en la carga: {plan.sobrantes.map(s => `${s.asignatura} en ${s.grupo}`).join(', ')}.
                <span className="block text-amber-800">Las notas y la asistencia ya registradas no se borran; solo deja de aparecer la asignatura en ese grupo.</span>
              </span>
            </label>
          )}

          <div className="flex gap-2 items-center">
            <button onClick={confirmar} disabled={!hayCambios || trabajando}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40">
              {trabajando ? 'Importando…' : 'Importar mi carga'}
            </button>
            {!hayCambios && <span className="text-slate-500">Su carga ya está al día; no hay nada que importar.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
