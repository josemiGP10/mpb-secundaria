// ============================================================
//  VIGENCIA (año escolar con el que trabaja la app)
//  Antes cada módulo tomaba el año del reloj. Ahora hay una sola
//  vigencia elegida en el encabezado: por defecto el año actual,
//  pero se puede volver a un año anterior para consultarlo o
//  pasar al siguiente para prepararlo.
//  Es una preferencia de este equipo (localStorage); si no hay
//  almacenamiento, se usa el año actual.
// ============================================================

import { useEffect, useState } from 'react';

const KEY = 'mpb_sec_vigencia';
const EVENTO = 'mpb:vigencia';

/** Año actual en hora de Colombia. */
export function anioActual(): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(new Date()));
}

export function leerVigencia(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (Number.isInteger(v) && v > 2000 && v < 2100) return v;
  } catch { /* sin almacenamiento */ }
  return anioActual();
}

export function cambiarVigencia(anio: number): void {
  try { localStorage.setItem(KEY, String(anio)); } catch { /* sin almacenamiento: solo en memoria */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: anio }));
}

/** Año de trabajo; se actualiza en todos los módulos cuando cambia. */
export function useVigencia(): number {
  const [anio, setAnio] = useState<number>(leerVigencia);
  useEffect(() => {
    const h = (e: Event) => setAnio((e as CustomEvent<number>).detail ?? leerVigencia());
    window.addEventListener(EVENTO, h);
    return () => window.removeEventListener(EVENTO, h);
  }, []);
  return anio;
}
