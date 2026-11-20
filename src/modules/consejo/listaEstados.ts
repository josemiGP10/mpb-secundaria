// ============================================================
//  LISTADO DE ESTADOS — mismo formato que entregó primaria
//  (APELLIDOS Y NOMBRES · ESTADO · ÁREA · NOTA · ASIGNATURA · NOTA)
//  con las categorías APROBADO, CURSANDO, REPROBADO, DESERTADO y
//  RETIRADO. Se genera en Excel (una hoja por grupo + resumen) y
//  también para imprimir.
// ============================================================

import {
  areasARecuperar, asignaturasDeArea, estadoInstitucional, nombreArea, nombreAsignatura, TEXTO_ESTADO,
  type Analisis, type ConfigConsejo, type Corte, type Decision, type DecisionConsejo,
  type EstadoInstitucional, type EstudianteConsejo, type GrupoConsejo,
} from './consejoService';
import { ESTILO, crearXlsx, descargar, ref, type Celda, type Hoja } from './xlsxWriter';

export interface EntradaLista {
  grupo: GrupoConsejo;
  est: EstudianteConsejo;
  an: Analisis;
  decision: Decision;
  guardada?: DecisionConsejo;
  sugerida?: Decision;          // lo que indicaba la regla
  retiradoDiario?: boolean;
  retiradoLista?: string | null;  // DESERTADO / RETIRADO según el listado de estados cargado
  motivoDesercion?: string;
}

interface AreaListada { area: string; nombre: string; nota: number; asigs: { nombre: string; nota: number }[] }
export interface FilaLista { nombre: string; estado: EstadoInstitucional; areas: AreaListada[]; observacion: string }

/** Observación para el listado impreso. SOLO explica retiros/deserciones.
 *  A propósito NO incluye los ajustes de nota, las decisiones distintas a
 *  la regla ni las observaciones escritas: lo del preconsejo y las
 *  comisiones es interno y no debe quedar rastro impreso. */
function observacion(x: EntradaLista, estado: EstadoInstitucional): string {
  if (estado !== 'RETIRADO') return '';
  if (x.retiradoDiario) return 'Retirado en la matrícula';
  if (x.retiradoLista) return x.retiradoLista === 'RETIRADO' ? 'Retirado' : 'Desertado';
  if (x.motivoDesercion) return 'Dejó de asistir';
  return '';
}

export const ESTADOS: EstadoInstitucional[] = ['APROBADO', 'CURSANDO', 'REPROBADO', 'RETIRADO'];

function construirFila(x: EntradaLista, corte: Corte, cfg: ConfigConsejo): FilaLista {
  const estado = estadoInstitucional(x.decision);
  // Qué áreas se listan: las perdidas si reprueba o está pendiente; solo las
  // escogidas por el consejo si va a recuperación; ninguna en los demás.
  let areas: string[] = [];
  if (estado === 'REPROBADO') areas = x.an.perdidas.map(p => p.area);
  else if (x.decision === 'RECUPERACION') areas = areasARecuperar(x.an.perdidas, x.guardada);
  else if (x.decision === 'PENDIENTE') areas = x.an.perdidas.map(p => p.area);

  return {
    nombre: x.est.nombre,
    estado,
    observacion: observacion(x, estado),
    areas: x.an.perdidas.filter(p => areas.includes(p.area)).map(p => ({
      area: p.area,
      nombre: nombreArea(p.area),
      nota: p.nota,
      asigs: asignaturasDeArea(x.grupo, p.area)
        .map(s => ({ nombre: nombreAsignatura(s), nota: x.est.asignaturas?.[corte]?.[s] ?? null }))
        .filter((o): o is { nombre: string; nota: number } => o.nota != null && o.nota < cfg.notaMinima)
        .sort((a, b) => a.nota - b.nota),
    })),
  };
}

export function construirListas(porGrupo: Map<GrupoConsejo, EntradaLista[]>, corte: Corte, cfg: ConfigConsejo) {
  return [...porGrupo.entries()].map(([g, xs]) => ({
    grupo: g,
    filas: [...xs].sort((a, b) => a.est.nombre.localeCompare(b.est.nombre, 'es')).map(x => construirFila(x, corte, cfg)),
  }));
}

// ── Excel ───────────────────────────────────────────────────

const TITULO_GRUPO = (g: GrupoConsejo) => g.nombre.toUpperCase();

function hojaGrupo(g: GrupoConsejo, filas: FilaLista[], anio: number): Hoja {
  const celdas: Celda[] = [];
  const combinadas: string[] = [];
  const put = (r: number, c: number, v: Celda['v'], s: number) => celdas.push({ r, c, v, s });

  put(0, 0, `I.E. RURAL MIGUEL PINEDO BARROS — ${anio}`, ESTILO.titulo);
  for (let c = 1; c < 8; c++) put(0, c, null, ESTILO.titulo);
  combinadas.push('A1:H1');
  put(1, 0, TITULO_GRUPO(g), ESTILO.titulo);
  for (let c = 1; c < 8; c++) put(1, c, null, ESTILO.titulo);
  combinadas.push('A2:H2');
  ['#', 'APELLIDOS Y NOMBRES', 'ESTADO', 'ÁREA', 'NOTA', 'ASIGNATURA', 'NOTA', 'OBSERVACIÓN']
    .forEach((h, c) => put(2, c, h, ESTILO.encabezado));

  let r = 3;
  filas.forEach((f, i) => {
    // Filas que ocupa el estudiante: una por asignatura de cada área listada
    const bloques = f.areas.map(a => Math.max(1, a.asigs.length));
    const alto = Math.max(1, bloques.reduce((s, n) => s + n, 0));
    const sNombre = ESTILO[`n${f.estado}` as const];
    const sEstado = ESTILO[f.estado];
    for (let k = 0; k < alto; k++) {
      put(r + k, 0, k === 0 ? i + 1 : null, ESTILO.centro);
      put(r + k, 1, k === 0 ? f.nombre : null, sNombre);
      put(r + k, 2, k === 0 ? TEXTO_ESTADO[f.estado] : null, sEstado);
      put(r + k, 7, k === 0 ? f.observacion || null : null, ESTILO.texto);
    }
    if (alto > 1) for (const c of [0, 1, 2, 7]) combinadas.push(`${ref(r, c)}:${ref(r + alto - 1, c)}`);

    if (f.areas.length === 0) {
      for (const c of [3, 4, 5, 6]) put(r, c, null, ESTILO.texto);
    }
    let rr = r;
    f.areas.forEach((a, j) => {
      const n = bloques[j];
      for (let k = 0; k < n; k++) {
        put(rr + k, 3, k === 0 ? a.nombre : null, ESTILO.texto);
        put(rr + k, 4, k === 0 ? a.nota : null, ESTILO.numeroRojo);
        const s = a.asigs[k];
        put(rr + k, 5, s ? s.nombre : null, ESTILO.texto);
        put(rr + k, 6, s ? s.nota : null, s ? ESTILO.numeroRojo : ESTILO.numero);
      }
      if (n > 1) for (const c of [3, 4]) combinadas.push(`${ref(rr, c)}:${ref(rr + n - 1, c)}`);
      rr += n;
    });
    r += alto;
  });
  return { nombre: g.nombre, celdas, combinadas, anchos: [5, 42, 21, 28, 7, 34, 7, 44] };
}

function hojaResumen(listas: ReturnType<typeof construirListas>, corte: Corte, cfg: ConfigConsejo, anio: number): Hoja {
  const celdas: Celda[] = [];
  const put = (r: number, c: number, v: Celda['v'], s: number) => celdas.push({ r, c, v, s });
  put(0, 0, `I.E. RURAL MIGUEL PINEDO BARROS — CONSEJO ACADÉMICO ${anio}`, ESTILO.titulo);
  for (let c = 1; c < 7; c++) put(0, c, null, ESTILO.titulo);
  put(1, 0, `Resumen de estados · ${corte === 'FINAL' ? 'Nota final' : corte} · Área perdida: nota < ${cfg.notaMinima.toFixed(1)} · Reprueba con ${cfg.areasParaReprobar} o más áreas`, ESTILO.normal);
  ['GRUPO', ...ESTADOS, 'TOTAL'].forEach((h, c) => put(3, c, h === 'GRUPO' || h === 'TOTAL' ? h : TEXTO_ESTADO[h as EstadoInstitucional], h === 'GRUPO' || h === 'TOTAL' ? ESTILO.encabezado : ESTILO[h as EstadoInstitucional]));
  const tot = Object.fromEntries(ESTADOS.map(e => [e, 0])) as Record<EstadoInstitucional, number>;
  listas.forEach((l, i) => {
    put(4 + i, 0, l.grupo.nombre, ESTILO.texto);
    ESTADOS.forEach((e, j) => {
      const n = l.filas.filter(f => f.estado === e).length;
      tot[e] += n;
      put(4 + i, j + 1, n, ESTILO.centro);
    });
    put(4 + i, ESTADOS.length + 1, l.filas.length, ESTILO.centro);
  });
  const rt = 4 + listas.length;
  put(rt, 0, 'TOTAL', ESTILO.encabezado);
  ESTADOS.forEach((e, j) => put(rt, j + 1, tot[e], ESTILO.encabezado));
  put(rt, ESTADOS.length + 1, Object.values(tot).reduce((s, n) => s + n, 0), ESTILO.encabezado);
  put(rt + 2, 0, 'APROBADO: promovido o recuperó · CURSANDO: va a recuperación (o pendiente) · REPROBADO: no promovido · DESERTADO/RETIRADO: dejó de asistir o tiene retiro en la matrícula', ESTILO.normal);
  return { nombre: 'RESUMEN', celdas, combinadas: ['A1:G1'], anchos: [16, 12, 12, 12, 21, 10] };
}

export function generarListaXlsx(porGrupo: Map<GrupoConsejo, EntradaLista[]>, corte: Corte, cfg: ConfigConsejo): Blob {
  const anio = new Date().getFullYear();
  const listas = construirListas(porGrupo, corte, cfg);
  return crearXlsx([hojaResumen(listas, corte, cfg, anio), ...listas.map(l => hojaGrupo(l.grupo, l.filas, anio))]);
}

export function descargarListaExcel(porGrupo: Map<GrupoConsejo, EntradaLista[]>, corte: Corte, cfg: ConfigConsejo): void {
  const anio = new Date().getFullYear();
  const fecha = new Date().toISOString().slice(0, 10);
  descargar(generarListaXlsx(porGrupo, corte, cfg), `Listado estados consejo ${anio} (${fecha}).xlsx`);
}

// ── Impresión (misma tabla, una hoja carta por grupo) ───────

const COLOR: Record<EstadoInstitucional, string> = {
  APROBADO: '#c6efce', CURSANDO: '#ffd9a0', REPROBADO: '#ffa7a7', RETIRADO: '#ffff00',
};
const escHtml = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export interface OpcionesImpresion {
  /** Estados que salen; los demás se omiten (p. ej. el acta sin aprobados). */
  estados?: EstadoInstitucional[];
  /** Texto a mostrar por estado (p. ej. CURSANDO → NIVELAR en el acta). */
  textos?: Partial<Record<EstadoInstitucional, string>>;
  /** Marca cada hoja como BORRADOR (documento de trabajo de la comisión). */
  borrador?: boolean;
}

const SELLO_BORRADOR = `<div style="border:2px dashed #b45309;color:#b45309;font-weight:bold;text-align:center;padding:4px;margin-bottom:6px;font-size:11px">
  BORRADOR — SUJETO A CAMBIOS DE LA COMISIÓN · NO ES EL ACTA FINAL</div>`;

export function htmlListas(
  porGrupo: Map<GrupoConsejo, EntradaLista[]>, corte: Corte, cfg: ConfigConsejo,
  encabezado: (g: GrupoConsejo) => string,
  pie?: (g: GrupoConsejo) => string,   // p. ej. firmas de la comisión
  opciones: OpcionesImpresion = {},
): string {
  const texto = (e: EstadoInstitucional) => opciones.textos?.[e] ?? TEXTO_ESTADO[e];
  const incluidos = opciones.estados ?? ESTADOS;
  return construirListas(porGrupo, corte, cfg).map(({ grupo, filas: todas }, idx) => {
    const filas = todas.filter(f => incluidos.includes(f.estado));
    const cuerpo = filas.length === 0
      ? `<tr><td colspan="8" class="c" style="padding:10px;color:#555">Ningún estudiante en ${incluidos.map(texto).join(' / ')}.</td></tr>`
      : filas.map((f, i) => {
      const bloques = f.areas.map(a => Math.max(1, a.asigs.length));
      const alto = Math.max(1, bloques.reduce((s, n) => s + n, 0));
      const cab = `<td class="num" rowspan="${alto}">${i + 1}</td>
        <td rowspan="${alto}" style="background:${COLOR[f.estado]}">${escHtml(f.nombre)}</td>
        <td class="c" rowspan="${alto}" style="background:${COLOR[f.estado]};font-weight:bold">${texto(f.estado)}</td>`;
      const obs = `<td rowspan="${alto}" style="font-size:9px;color:#333">${escHtml(f.observacion)}</td>`;
      if (f.areas.length === 0) return `<tr>${cab}<td></td><td></td><td></td><td></td>${obs}</tr>`;
      const trs: string[] = [];
      f.areas.forEach((a, j) => {
        const n = bloques[j];
        for (let k = 0; k < n; k++) {
          const s = a.asigs[k];
          const primera = trs.length === 0;
          trs.push(`<tr>${primera ? cab : ''}${k === 0 ? `<td rowspan="${n}">${escHtml(a.nombre)}</td><td class="c perd" rowspan="${n}">${a.nota.toFixed(1)}</td>` : ''}
            <td>${s ? escHtml(s.nombre) : ''}</td><td class="c perd">${s ? s.nota.toFixed(1) : ''}</td>${primera ? obs : ''}</tr>`);
        }
      });
      return trs.join('');
    }).join('');
    const conteo = incluidos.map(e => `${texto(e)}: ${filas.filter(f => f.estado === e).length}`).join(' · ');
    return `<div class="${idx > 0 ? 'pg' : ''}">
      ${opciones.borrador ? SELLO_BORRADOR : ''}
      ${encabezado(grupo)}
      <table><thead><tr><th class="num">#</th><th>Apellidos y nombres</th><th>Estado</th><th>Área</th><th>Nota</th><th>Asignatura</th><th>Nota</th><th>Observación</th></tr></thead>
      <tbody>${cuerpo}</tbody></table>
      <p style="margin-top:6px;font-size:9px;color:#444">${conteo}</p>
      ${pie ? pie(grupo) : ''}
    </div>`;
  }).join('');
}
