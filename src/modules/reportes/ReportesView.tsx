import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getEstudiantesPorGrupo, getEstudiantesRetiradosPorGrupo } from '@/db/database';
import { cargarActividades, cargarFilasGrupo } from '../calificaciones/calificacionesService';
import { generarDistribucionSalones, type Salones } from './salonesService';
import type { Area, Asignatura, Grupo } from '@/db/types';

function sortGrupos<T extends { grado_cod: number; nombre: string }>(gs: T[]): T[] {
  return [...gs].sort((a, b) =>
    a.grado_cod !== b.grado_cod ? a.grado_cod - b.grado_cod : a.nombre.localeCompare(b.nombre, 'es'),
  );
}

type TipoReporte = 'notas' | 'asistencia' | 'salones' | 'matricula';

// ── CSS del reporte imprimible ──────────────────────────────
const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; padding: 12px; }
.header { text-align: center; border-bottom: 1.5px solid #333; padding-bottom: 8px; margin-bottom: 14px; }
.header-row { display: flex; align-items: center; justify-content: center; gap: 10px; }
.header-row .logo { height: 40px; width: auto; flex-shrink: 0; }
.header h1 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
.header h2 { font-size: 11px; margin-top: 5px; }
.sub { font-size: 9px; color: #666; margin-top: 3px; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
th { background: #e0e0e0; font-weight: bold; font-size: 9px; text-transform: uppercase; }
td, th { border: 0.5px solid #aaa; padding: 3px 5px; vertical-align: middle; }
.c { text-align: center; }
.num { width: 22px; text-align: center; color: #666; }
.nombre { min-width: 130px; }
.nota { width: 36px; text-align: center; }
.final { width: 40px; text-align: center; font-weight: bold; }
.desemp { width: 55px; text-align: center; }
.verde { color: #166534; }
.rojo  { color: #991b1b; }
.footer { margin-top: 14px; font-size: 9px; color: #888; display: flex; justify-content: space-between; }
.firma { margin-top: 36px; border-top: 0.5px solid #aaa; width: 180px; text-align: center; padding-top: 4px; font-size: 9px; color: #555; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

// ── CSS del listado de salones — para pegar en cartelera ────
// Letra grande y a dos columnas: se lee de pie, no en un escritorio.
const SALON_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 18px 28px; }
.salon-page { page-break-after: always; }
.header { text-align: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 9px; margin-bottom: 13px; }
.header-row { display: flex; align-items: center; justify-content: center; gap: 12px; }
.header-row .logo { height: 52px; width: auto; flex-shrink: 0; }
.header h1 { font-size: 17px; text-transform: uppercase; letter-spacing: 0.5px; color: #333; }
.header .sub { font-size: 11px; color: #666; margin-top: 2px; }
.salon-titulo { font-size: 40px; font-weight: 900; color: #1e3a8a; margin: 6px 0 1px; letter-spacing: 1px; line-height: 1; }
.salon-examen { font-size: 17px; font-weight: 600; color: #333; margin-top: 2px; }
.lista { column-count: 2; column-gap: 28px; }
.item { break-inside: avoid; display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #ddd; }
.item .num { font-size: 14px; font-weight: 700; color: #94a3b8; width: 24px; flex-shrink: 0; }
.item .nombre { font-size: 17px; font-weight: 600; flex: 1; line-height: 1.1; }
.item .grado { font-size: 13px; font-weight: 700; color: #1e3a8a; background: #dbeafe; padding: 2px 8px; border-radius: 7px; flex-shrink: 0; white-space: nowrap; }
.salon-footer { margin-top: 11px; font-size: 11px; color: #888; text-align: center; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const LOGO_URL = `${window.location.origin}/logo-iermpb.jpg`;
const UBICACION = 'La Punta de los Remedios, Dibulla - La Guajira';

function reportEncabezado(titulo: string, sub1: string, sub2 = ''): string {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div class="header">
      <div class="header-row">
        <img class="logo" src="${LOGO_URL}" alt="" />
        <div>
          <h1>I.E. Rural Miguel Pinedo Barros</h1>
          <p class="sub">${UBICACION} · ${new Date().getFullYear()}</p>
        </div>
      </div>
      <h2>${titulo}</h2>
      <p class="sub">${sub1}${sub2 ? ' · ' + sub2 : ''}</p>
      <p class="sub">Fecha: ${hoy} · Docente: J. González</p>
    </div>
  `;
}

function abrirVentana(titulo: string, cuerpo: string, css: string = PRINT_CSS): void {
  const win = window.open('', '_blank', 'width=960,height=720');
  if (!win) {
    alert('Permita ventanas emergentes en su navegador para imprimir.');
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">` +
    `<title>${titulo}</title><style>${css}</style></head>` +
    `<body>${cuerpo}</body></html>`,
  );
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function desempeno(nota: number | undefined): string {
  if (nota === undefined) return '—';
  if (nota >= 9.0) return 'Superior';
  if (nota >= 7.5) return 'Alto';
  if (nota >= 6.0) return 'Básico';
  return 'Bajo';
}

// ── Generadores de HTML ──────────────────────────────────────

async function imprimirNotas(
  grupoId: string, asigId: string, periodo: number, anio: number,
  grupoNombre: string, asigNombre: string,
  tipoArea: 'BASICA' | 'COMPLEMENTARIA',
  labelPeriodo: string,
): Promise<void> {
  const [actividades, filas] = await Promise.all([
    cargarActividades(grupoId, asigId, periodo, anio),
    cargarFilasGrupo(grupoId, asigId, periodo, anio),
  ]);

  const esBasica = tipoArea === 'BASICA';

  const actCols = actividades.map(a =>
    `<th class="nota">${a.nombre}</th>`,
  ).join('');

  const thead = `<tr>
    <th class="num">Nº</th>
    <th class="nombre">Estudiante</th>
    ${actCols}
    <th class="nota">Cog.</th>
    ${esBasica ? '<th class="nota">Prueba</th>' : ''}
    <th class="nota">Social</th>
    <th class="nota">Personal</th>
    <th class="final">Final</th>
    <th class="desemp">Desempeño</th>
  </tr>`;

  const tbody = filas.map((fila, idx) => {
    const notas = actividades.map(a => {
      const v = fila.notasPorActividad[a.id]?.valor;
      return `<td class="nota">${v !== undefined ? v.toFixed(1) : ''}</td>`;
    }).join('');

    const vals = actividades
      .map(a => fila.notasPorActividad[a.id]?.valor)
      .filter((v): v is number => v !== undefined);
    const cogProm = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : undefined;
    const final  = fila.nota_final;
    const cls    = final !== undefined && final < 6 ? 'rojo' : 'verde';

    return `<tr>
      <td class="num">${idx + 1}</td>
      <td class="nombre">${fila.nombreCompleto}</td>
      ${notas}
      <td class="nota">${cogProm !== undefined ? cogProm.toFixed(1) : ''}</td>
      ${esBasica ? `<td class="nota">${fila.prueba_institucional !== undefined ? fila.prueba_institucional.toFixed(1) : ''}</td>` : ''}
      <td class="nota">${fila.nota_social.toFixed(1)}</td>
      <td class="nota">${fila.nota_personal.toFixed(1)}</td>
      <td class="final ${cls}">${final !== undefined ? final.toFixed(1) : '—'}</td>
      <td class="desemp">${desempeno(final)}</td>
    </tr>`;
  }).join('');

  const aprobados = filas.filter(f => (f.nota_final ?? 0) >= 6).length;

  const cuerpo =
    reportEncabezado(
      `Reporte de Notas — Grupo ${grupoNombre}`,
      `Asignatura: ${asigNombre}`,
      labelPeriodo,
    ) +
    `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>` +
    `<div class="footer">
      <span>Total: ${filas.length} estudiantes · Aprobados: ${aprobados} · Reprobados: ${filas.length - aprobados}</span>
      <span>Escala 1.0 – 10.0 · Aprobación ≥ 6.0</span>
    </div>
    <div class="firma">J. González · Docente</div>`;

  abrirVentana(`Notas ${grupoNombre} ${asigNombre} ${labelPeriodo}`, cuerpo);
}

async function imprimirAsistencia(
  grupoId: string, asigId: string, anio: number,
  grupoNombre: string, asigNombre: string,
): Promise<void> {
  const [paresActivos, paresRetirados] = await Promise.all([
    getEstudiantesPorGrupo(grupoId, anio),
    getEstudiantesRetiradosPorGrupo(grupoId, anio),
  ]);
  // Mismo criterio que Asistencia/Notas/Salones: si hay matrículas duplicadas
  // (siembra multi-dispositivo), un mismo estudiante puede aparecer como
  // activo Y retirado — la versión retirada tiene precedencia y se excluye.
  const retiradosKeys = new Set(
    paresRetirados.map(p => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
  );
  const pares = paresActivos.filter(
    p => !retiradosKeys.has(`${p.estudiante.tipo_doc}-${p.estudiante.doc}`),
  );

  const matriculaIds = new Set(pares.map(p => p.matricula.id));
  const todosRegistros = await db.registros_asistencia
    .where('asignatura_id').equals(asigId).toArray();
  const registros = todosRegistros.filter(r => matriculaIds.has(r.matricula_id));

  const conteo: Record<string, { asiste: number; fj: number; fi: number }> = {};
  for (const p of pares) conteo[p.matricula.id] = { asiste: 0, fj: 0, fi: 0 };
  for (const r of registros) {
    if (!conteo[r.matricula_id]) continue;
    if (r.estado === 'ASISTE') conteo[r.matricula_id].asiste++;
    else if (r.estado === 'FJ')    conteo[r.matricula_id].fj++;
    else if (r.estado === 'FI')    conteo[r.matricula_id].fi++;
  }

  const filas = pares
    .map(({ matricula, estudiante }) => {
      const nombre = [estudiante.apellido1, estudiante.apellido2, estudiante.nombre1, estudiante.nombre2].filter(Boolean).join(' ');
      const { asiste, fj, fi } = conteo[matricula.id] ?? { asiste: 0, fj: 0, fi: 0 };
      const total = asiste + fj + fi;
      const pct   = total > 0 ? Math.round((asiste / total) * 100) : 100;
      return { nombre, asiste, fj, fi, total, pct };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const tbody = filas.map((f, i) => {
    const cls = f.pct < 80 ? 'rojo' : 'verde';
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="nombre">${f.nombre}</td>
      <td class="c">${f.asiste}</td>
      <td class="c">${f.fj}</td>
      <td class="c">${f.fi}</td>
      <td class="c">${f.total}</td>
      <td class="final ${cls}">${f.pct}%</td>
    </tr>`;
  }).join('');

  const cuerpo =
    reportEncabezado(
      `Reporte de Asistencia — Grupo ${grupoNombre}`,
      `Asignatura: ${asigNombre}`,
      `Año ${anio}`,
    ) +
    `<table>
      <thead><tr>
        <th class="num">Nº</th>
        <th class="nombre">Estudiante</th>
        <th class="c">Asiste</th>
        <th class="c">F.J.</th>
        <th class="c">F.I.</th>
        <th class="c">Total</th>
        <th class="final">%</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>` +
    `<div class="footer">
      <span>Total: ${filas.length} estudiantes</span>
      <span>Asistencia mínima requerida: 80%</span>
    </div>
    <div class="firma">J. González · Docente</div>`;

  abrirVentana(`Asistencia ${grupoNombre} ${asigNombre}`, cuerpo);
}

function imprimirSalones(salones: Salones, tituloExamen: string, anio: number): void {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });

  const bloques = salones.map((estudiantes, idx) => {
    const items = estudiantes.map((e, i) => `
      <div class="item">
        <span class="num">${i + 1}.</span>
        <span class="nombre">${e.nombreCompleto}</span>
        <span class="grado">${e.grupoNombre}</span>
      </div>`).join('');

    return `
      <div class="salon-page">
        <div class="header">
          <div class="header-row">
            <img class="logo" src="${LOGO_URL}" alt="" />
            <div>
              <h1>I.E. Rural Miguel Pinedo Barros</h1>
              <p class="sub">${UBICACION} · ${anio}</p>
            </div>
          </div>
          <div class="salon-titulo">SALÓN ${idx + 1}</div>
          <p class="salon-examen">${tituloExamen}</p>
          <p class="sub">Fecha: ${hoy}</p>
        </div>
        <div class="lista">${items}</div>
        <div class="salon-footer">
          Total: ${estudiantes.length} estudiantes · Salón ${idx + 1} de ${salones.length}
        </div>
      </div>`;
  }).join('');

  abrirVentana(`Distribución ${tituloExamen}`, bloques, SALON_CSS);
}

// ── Reporte de matrícula: activos y retirados por grado ─────

type ParEst = Awaited<ReturnType<typeof getEstudiantesPorGrupo>>[number];
interface MatriculaGrupo { grupo: Grupo; activos: ParEst[]; retirados: ParEst[] }

const claveDoc = (p: ParEst) => `${p.estudiante.tipo_doc}-${p.estudiante.doc}`;
const nombreCompleto = (p: ParEst) => {
  const e = p.estudiante;
  return [e.apellido1, e.apellido2, e.nombre1, e.nombre2].filter(Boolean).join(' ');
};

async function cargarMatriculaPorGrupo(grupos: Grupo[], anio: number): Promise<MatriculaGrupo[]> {
  return Promise.all(sortGrupos(grupos).map(async grupo => {
    const [act, ret] = await Promise.all([
      getEstudiantesPorGrupo(grupo.id, anio),
      getEstudiantesRetiradosPorGrupo(grupo.id, anio),
    ]);
    // Mismo criterio que el resto de la app: si hay duplicados y uno está
    // retirado, la versión retirada tiene precedencia.
    const retKeys = new Set(ret.map(claveDoc));
    return { grupo, activos: act.filter(p => !retKeys.has(claveDoc(p))), retirados: ret };
  }));
}

function imprimirMatricula(datos: MatriculaGrupo[], anio: number): void {
  const totA = datos.reduce((s, d) => s + d.activos.length, 0);
  const totR = datos.reduce((s, d) => s + d.retirados.length, 0);

  const resumen = `
    <table>
      <thead><tr><th>Grado</th><th class="c">Activos</th><th class="c">Retirados</th><th class="c">Total</th></tr></thead>
      <tbody>
        ${datos.map(d => `
          <tr><td>${d.grupo.nombre}</td>
          <td class="c">${d.activos.length}</td>
          <td class="c rojo">${d.retirados.length}</td>
          <td class="c">${d.activos.length + d.retirados.length}</td></tr>`).join('')}
        <tr><th style="text-align:left">TOTAL</th><th>${totA}</th><th>${totR}</th><th>${totA + totR}</th></tr>
      </tbody>
    </table>`;

  const detalle = datos.map(d => `
    <h3 style="margin:16px 0 4px;font-size:11px;">${d.grupo.nombre} — ${d.activos.length} activos · ${d.retirados.length} retirados</h3>
    <table>
      <thead><tr><th class="num">#</th><th class="nombre">Estudiante</th><th>Documento</th><th class="c">Estado</th><th>Observación</th></tr></thead>
      <tbody>
        ${[...d.activos.map(p => ({ p, ret: false })), ...d.retirados.map(p => ({ p, ret: true }))]
          .map(({ p, ret }, i) => `
            <tr><td class="num">${i + 1}</td>
            <td class="nombre">${nombreCompleto(p)}</td>
            <td>${p.estudiante.tipo_doc} ${p.estudiante.doc}</td>
            <td class="c ${ret ? 'rojo' : 'verde'}">${ret ? 'Retirado' : 'Activo'}</td>
            <td>${ret ? (p.matricula.retiro_observaciones ?? '') : ''}</td></tr>`).join('')}
      </tbody>
    </table>`).join('');

  abrirVentana(
    `Matrícula ${anio}`,
    reportEncabezado('Estudiantes activos y retirados por grado', `Año lectivo ${anio}`) +
      resumen + detalle +
      `<div class="footer"><span>Total activos: ${totA} · Total retirados: ${totR}</span><span>Diario Pedagógico MPB</span></div>`,
  );
}

// ── Listas de chequeo para simulacro de emergencia ──────────
// Una página por grupo, solo estudiantes activos, con casillas
// Presente/Ausente para que el director de grupo haga el conteo.

const SIMULACRO_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
.page { padding: 14px 22px; page-break-after: always; }
.hdr { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #b91c1c; padding-bottom: 6px; margin-bottom: 8px; }
.hdr img { height: 46px; }
.hdr h1 { font-size: 13px; text-transform: uppercase; }
.hdr .sub { font-size: 9px; color: #555; }
.tit { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; }
.tit h2 { font-size: 15px; color: #b91c1c; text-transform: uppercase; }
.tit .grupo { font-size: 22px; font-weight: 900; }
.meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 14px; font-size: 10px; margin-bottom: 8px; }
.meta span { display: block; border-bottom: 1px solid #999; height: 16px; padding-top: 2px; }
table { width: 100%; border-collapse: collapse; }
th { background: #e5e5e5; font-size: 9px; text-transform: uppercase; border: 0.5px solid #888; padding: 4px; }
td { border: 0.5px solid #888; padding: 3px 5px; height: 20px; }
.n { width: 24px; text-align: center; color: #666; }
.chk { width: 62px; text-align: center; }
.box { display: inline-block; width: 13px; height: 13px; border: 1.3px solid #222; border-radius: 2px; }
.obs { width: 30%; }
.tot { display: flex; gap: 18px; margin-top: 10px; font-size: 11px; font-weight: bold; }
.tot span { display: inline-block; min-width: 44px; border-bottom: 1px solid #222; }
.firma { margin-top: 28px; display: flex; justify-content: space-between; font-size: 9px; color: #444; }
.firma div { border-top: 0.5px solid #555; width: 220px; text-align: center; padding-top: 3px; }
.nota { font-size: 8.5px; color: #666; margin-top: 6px; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function imprimirListasSimulacro(datos: MatriculaGrupo[]): void {
  const hoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  const filaVacia = `<tr><td class="n">+</td><td></td><td class="chk"><span class="box"></span></td><td class="chk"><span class="box"></span></td><td class="obs"></td></tr>`;
  const paginas = datos.filter(d => d.activos.length > 0).map(d => {
    const lista = [...d.activos].sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'));
    return `
    <div class="page">
      <div class="hdr"><img src="${LOGO_URL}" alt="" /><div>
        <h1>I.E. Rural Miguel Pinedo Barros</h1><p class="sub">${UBICACION}</p></div></div>
      <div class="tit"><h2>Simulacro de emergencia — Lista de chequeo</h2><div class="grupo">${d.grupo.nombre}</div></div>
      <div class="meta">
        <label>Fecha<span>${hoy}</span></label>
        <label>Hora de conteo<span></span></label>
        <label>Punto de encuentro<span></span></label>
        <label style="grid-column: span 2">Director(a) de grupo<span></span></label>
        <label>Estudiantes activos<span style="font-weight:bold">${lista.length}</span></label>
      </div>
      <table>
        <thead><tr><th>#</th><th style="text-align:left">Estudiante</th><th>Presente</th><th>Ausente</th><th>Observación (no vino hoy / lesionado / con acudiente)</th></tr></thead>
        <tbody>
          ${lista.map((p, i) => `<tr><td class="n">${i + 1}</td><td>${nombreCompleto(p)}</td><td class="chk"><span class="box"></span></td><td class="chk"><span class="box"></span></td><td class="obs"></td></tr>`).join('')}
          ${filaVacia.repeat(3)}
        </tbody>
      </table>
      <div class="tot">Presentes: <span></span> Ausentes: <span></span> No ubicados: <span></span></div>
      <div class="firma"><div>Firma director(a) de grupo</div><div>Recibido — Brigada / Coordinación</div></div>
      <p class="nota">Las filas con "+" son para estudiantes que no aparecen en la lista. Solo incluye estudiantes activos (sin retirados).</p>
    </div>`;
  }).join('');
  abrirVentana('Listas simulacro — Secundaria', paginas, SIMULACRO_CSS);
}

// ── Totalizado institucional (sin separar por grado) ────────
// Un estudiante puede tener matrícula en dos grupos (p. ej. pasó de un grado
// regular a MEF, con documento "123_mef"). Aquí se cuenta una sola vez:
// si está activo en algún grupo cuenta como activo; si no, como retirado.

interface FilaTotal { par: ParEst; activo: boolean; grupo: string; obs: string }

function totalizarMatricula(datos: MatriculaGrupo[]): FilaTotal[] {
  const norm = (p: ParEst) => `${p.estudiante.tipo_doc}-${p.estudiante.doc.replace(/_mef$/i, '')}`;
  const mapa = new Map<string, FilaTotal>();
  for (const d of datos) {
    for (const p of d.activos) {
      const k = norm(p);
      const prev = mapa.get(k);
      if (!prev || !prev.activo) mapa.set(k, { par: p, activo: true, grupo: d.grupo.nombre, obs: '' });
    }
    for (const p of d.retirados) {
      const k = norm(p);
      if (!mapa.has(k)) mapa.set(k, { par: p, activo: false, grupo: d.grupo.nombre, obs: p.matricula.retiro_observaciones ?? '' });
    }
  }
  return [...mapa.values()].sort((a, b) => nombreCompleto(a.par).localeCompare(nombreCompleto(b.par), 'es'));
}

function imprimirMatriculaTotalizado(datos: MatriculaGrupo[], anio: number): void {
  const filas = totalizarMatricula(datos);
  const act = filas.filter(f => f.activo);
  const ret = filas.filter(f => !f.activo);

  const caja = (label: string, n: number, color: string) =>
    `<div style="flex:1;border:1px solid #aaa;border-radius:6px;padding:10px;text-align:center;">
       <div style="font-size:9px;color:#666;text-transform:uppercase;">${label}</div>
       <div style="font-size:24px;font-weight:bold;color:${color};">${n}</div></div>`;

  const lista = (titulo: string, fs: FilaTotal[], conObs: boolean) => `
    <h3 style="margin:16px 0 4px;font-size:11px;">${titulo} (${fs.length})</h3>
    <table>
      <thead><tr><th class="num">#</th><th class="nombre">Estudiante</th><th>Documento</th><th class="c">Grado</th>${conObs ? '<th>Observación</th>' : ''}</tr></thead>
      <tbody>${fs.map((f, i) => `
        <tr><td class="num">${i + 1}</td><td class="nombre">${nombreCompleto(f.par)}</td>
        <td>${f.par.estudiante.tipo_doc} ${f.par.estudiante.doc.replace(/_mef$/i, '')}</td>
        <td class="c">${f.grupo}</td>${conObs ? `<td>${f.obs}</td>` : ''}</tr>`).join('')}
      </tbody>
    </table>`;

  abrirVentana(
    `Matrícula totalizada ${anio}`,
    reportEncabezado('Consolidado institucional de matrícula — Secundaria', `Año lectivo ${anio}`, 'Incluye grados regulares y MEF') +
      `<div style="display:flex;gap:10px;margin:6px 0 4px;">
         ${caja('Total estudiantes', filas.length, '#111')}
         ${caja('Activos', act.length, '#166534')}
         ${caja('Retirados', ret.length, '#991b1b')}
       </div>` +
      lista('Estudiantes retirados', ret, true) +
      lista('Estudiantes activos', act, false) +
      `<div class="footer"><span>Cada estudiante se cuenta una sola vez aunque tenga matrícula en más de un grupo.</span><span>Diario Pedagógico MPB</span></div>`,
  );
}

// ── Componente principal ────────────────────────────────────

export function ReportesView() {
  const anio = new Date().getFullYear();

  const [grupoId,   setGrupoId]   = useState('');
  const [asigId,    setAsigId]    = useState('');
  const [periodo,   setPeriodo]   = useState(1);
  const [tipo,      setTipo]      = useState<TipoReporte>('notas');
  const [generando, setGenerando] = useState(false);

  // ── Distribución de salones (Prueba Institucional) ────────
  const [numSalones,       setNumSalones]       = useState(15);
  const [tituloExamen,     setTituloExamen]      = useState('Prueba Institucional');
  const [salonesPreview,   setSalonesPreview]    = useState<Salones | null>(null);
  const [generandoSalones, setGenerandoSalones]  = useState(false);

  const grupos     = useLiveQuery<Grupo[]>(     () => db.grupos.where('anio').equals(anio).toArray(), [anio]);
  const todasAsigs = useLiveQuery<Asignatura[]>(() => db.asignaturas.toArray(), []);
  const areas      = useLiveQuery<Area[]>(      () => db.areas.toArray(),       []);

  const matriculaDatos = useLiveQuery<MatriculaGrupo[] | undefined>(
    async () => (tipo === 'matricula' && grupos ? cargarMatriculaPorGrupo(grupos, anio) : undefined),
    [tipo, grupos, anio],
  );

  const asignaturasGrupo = useLiveQuery<Asignatura[]>(async () => {
    if (!todasAsigs || !grupoId) return [];
    const ga = await db.grupo_asignaturas.where('grupo_id').equals(grupoId).toArray();
    if (ga.length === 0) return todasAsigs;
    const ids = new Set(ga.map(x => x.asignatura_id));
    return todasAsigs.filter(a => ids.has(a.id));
  }, [grupoId, todasAsigs]) ?? [];

  const grupoSelec  = grupos?.find(g => g.id === grupoId);
  const asigSelec   = asignaturasGrupo.find(a => a.id === asigId);
  const areaSelec   = areas?.find(a => a.id === asigSelec?.area_id);
  const tipoArea    = (areaSelec?.tipo ?? 'COMPLEMENTARIA') as 'BASICA' | 'COMPLEMENTARIA';
  const numPeriodos = grupoSelec?.num_periodos ?? 4;
  const labelPer    = numPeriodos === 2 ? 'Semestre' : 'Período';
  const canPrint    = !!grupoId && !!asigId;

  const handleImprimir = async () => {
    if (!canPrint || generando) return;
    setGenerando(true);
    try {
      if (tipo === 'notas') {
        await imprimirNotas(
          grupoId, asigId, periodo, anio,
          grupoSelec?.nombre ?? '', asigSelec?.nombre ?? '',
          tipoArea, `${labelPer} ${periodo}`,
        );
      } else {
        await imprimirAsistencia(
          grupoId, asigId, anio,
          grupoSelec?.nombre ?? '', asigSelec?.nombre ?? '',
        );
      }
    } catch (e) {
      console.error(e);
      alert('Error generando el reporte. Intente de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  const handleGenerarSalones = async () => {
    if (generandoSalones || numSalones < 1) return;
    setGenerandoSalones(true);
    try {
      setSalonesPreview(await generarDistribucionSalones(anio, numSalones));
    } catch (e) {
      console.error(e);
      alert('Error generando la distribución. Intente de nuevo.');
    } finally {
      setGenerandoSalones(false);
    }
  };

  const handleImprimirSalones = () => {
    if (!salonesPreview) return;
    imprimirSalones(salonesPreview, tituloExamen.trim() || 'Prueba Institucional', anio);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Selectores */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-surface-muted bg-surface-card flex-shrink-0">
        {tipo === 'matricula' ? null : tipo !== 'salones' ? (
          <div className="flex gap-1.5">
            <select
              value={grupoId}
              onChange={e => { setGrupoId(e.target.value); setAsigId(''); setPeriodo(1); }}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="">— Grupo —</option>
              {sortGrupos(grupos ?? []).map(g => (
                <option key={g.id} value={g.id}>{g.nombre}</option>
              ))}
            </select>
            <select
              value={asigId}
              onChange={e => setAsigId(e.target.value)}
              disabled={!grupoId}
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 disabled:opacity-40"
            >
              <option value="">— Asignatura —</option>
              {asignaturasGrupo.map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              type="text"
              value={tituloExamen}
              onChange={e => { setTituloExamen(e.target.value); setSalonesPreview(null); }}
              placeholder="Título del examen"
              className="flex-1 min-w-0 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              min={1}
              max={50}
              value={numSalones}
              onChange={e => { setNumSalones(Math.max(1, Number(e.target.value) || 1)); setSalonesPreview(null); }}
              title="Número de salones"
              className="w-16 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Tipo + período */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['notas', 'asistencia', 'salones', 'matricula'] as TipoReporte[]).map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors
                  ${tipo === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {t === 'notas' ? '✎ Notas' : t === 'asistencia' ? '✓ Asistencia' : t === 'salones' ? '🎲 Salones' : '👥 Matrícula'}
              </button>
            ))}
          </div>

          {tipo === 'notas' && grupoId && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">{labelPer}:</span>
              {Array.from({ length: numPeriodos }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriodo(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors
                    ${periodo === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cuerpo */}
      {tipo === 'matricula' ? (
        <div className="flex-1 flex flex-col items-center gap-4 p-6 text-center overflow-y-auto">
          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Activos y retirados por grado</h2>
            <p className="text-sm text-slate-500 max-w-xs">
              Conteo desde la base local de este equipo, año {anio}.
            </p>
          </div>

          {!matriculaDatos ? (
            <span className="w-6 h-6 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
          ) : (
            <>
              <table className="w-full max-w-sm text-xs text-slate-700 border border-slate-200 rounded-xl overflow-hidden">
                <thead className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-1.5">Grado</th>
                    <th className="px-2 py-1.5">Activos</th>
                    <th className="px-2 py-1.5">Retirados</th>
                    <th className="px-2 py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matriculaDatos.map(d => (
                    <tr key={d.grupo.id} className="border-t border-slate-100">
                      <td className="text-left px-3 py-1.5 font-medium">{d.grupo.nombre}</td>
                      <td className="px-2 py-1.5 text-emerald-700 font-semibold">{d.activos.length}</td>
                      <td className="px-2 py-1.5 text-red-700 font-semibold">{d.retirados.length}</td>
                      <td className="px-2 py-1.5">{d.activos.length + d.retirados.length}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="text-left px-3 py-1.5">TOTAL</td>
                    <td className="px-2 py-1.5">{matriculaDatos.reduce((s, d) => s + d.activos.length, 0)}</td>
                    <td className="px-2 py-1.5">{matriculaDatos.reduce((s, d) => s + d.retirados.length, 0)}</td>
                    <td className="px-2 py-1.5">{matriculaDatos.reduce((s, d) => s + d.activos.length + d.retirados.length, 0)}</td>
                  </tr>
                </tbody>
              </table>

              {(() => {
                const tot = totalizarMatricula(matriculaDatos);
                const a = tot.filter(f => f.activo).length;
                return (
                  <div className="w-full max-w-sm grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white py-2">
                      <p className="text-[10px] text-slate-400 uppercase">Total</p>
                      <p className="text-xl font-bold text-slate-800">{tot.length}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 py-2">
                      <p className="text-[10px] text-emerald-600 uppercase">Activos</p>
                      <p className="text-xl font-bold text-emerald-700">{a}</p>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-50 py-2">
                      <p className="text-[10px] text-red-600 uppercase">Retirados</p>
                      <p className="text-xl font-bold text-red-700">{tot.length - a}</p>
                    </div>
                    <p className="col-span-3 text-[10px] text-slate-400">
                      Totalizado institucional: cada estudiante cuenta una sola vez aunque esté en dos grupos.
                    </p>
                  </div>
                );
              })()}

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => imprimirMatriculaTotalizado(matriculaDatos, anio)}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all"
                >
                  <span>🖨</span> Totalizado
                </button>
                <button
                  onClick={() => imprimirMatricula(matriculaDatos, anio)}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-blue-600 text-blue-700 font-semibold text-sm shadow hover:bg-blue-50 active:scale-95 transition-all"
                >
                  <span>🖨</span> Por grado
                </button>
              </div>
              <button
                onClick={() => imprimirListasSimulacro(matriculaDatos)}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-red-600 text-white font-semibold text-sm shadow hover:bg-red-700 active:scale-95 transition-all"
              >
                <span>📋</span> Listas para simulacro
              </button>
              <p className="text-[10px] text-slate-300 max-w-xs">
                Totalizado: cifras generales y listado único de retirados y activos. Por grado: resumen y listado de cada grado.
              </p>
            </>
          )}
        </div>
      ) : tipo !== 'salones' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center">
          <div className="text-5xl select-none">🖨</div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">
              {tipo === 'notas' ? 'Boletín de Notas' : 'Reporte de Asistencia'}
            </h2>
            <p className="text-sm text-slate-500 max-w-xs">
              {tipo === 'notas'
                ? 'Abre una ventana con la tabla de calificaciones lista para imprimir o guardar como PDF.'
                : 'Abre una ventana con el resumen de asistencia por estudiante listo para imprimir.'}
            </p>
          </div>

          {canPrint && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-3 text-left text-sm text-slate-700 space-y-1 w-full max-w-xs">
              <p>
                <span className="text-slate-400 text-xs block">Grupo</span>
                <strong>{grupoSelec?.nombre}</strong>
              </p>
              <p>
                <span className="text-slate-400 text-xs block">Asignatura</span>
                <strong>{asigSelec?.nombre}</strong>
              </p>
              {tipo === 'notas' && (
                <p>
                  <span className="text-slate-400 text-xs block">{labelPer}</span>
                  <strong>{periodo}</strong>
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleImprimir}
            disabled={!canPrint || generando}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generando ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Generando...
              </>
            ) : (
              <><span>🖨</span> Imprimir / Guardar PDF</>
            )}
          </button>

          {!canPrint && (
            <p className="text-xs text-slate-400">Seleccione grupo y asignatura para continuar</p>
          )}

          <p className="text-[10px] text-slate-300 max-w-xs">
            Se abrirá una nueva ventana. En el diálogo de impresión puede elegir "Guardar como PDF" para exportar el archivo.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center overflow-y-auto">
          <div className="text-5xl select-none">🎲</div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Distribución para Prueba Institucional</h2>
            <p className="text-sm text-slate-500 max-w-xs">
              Mezcla los estudiantes activos de toda la secundaria (incluidos los MEF) en {numSalones} salones,
              repartiendo cada curso entre todos para reducir el riesgo de copia. Los retirados no se incluyen.
            </p>
          </div>

          <button
            onClick={handleGenerarSalones}
            disabled={generandoSalones}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-blue-600 text-white font-semibold text-sm shadow hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generandoSalones ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Mezclando...
              </>
            ) : (
              <><span>🎲</span> {salonesPreview ? 'Volver a mezclar' : 'Generar distribución'}</>
            )}
          </button>

          {salonesPreview && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-left text-xs text-slate-700 w-full max-w-sm">
                <p className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mb-2">
                  Vista previa · {salonesPreview.reduce((s, sal) => s + sal.length, 0)} estudiantes
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {salonesPreview.map((sal, i) => (
                    <div key={i} className="rounded-lg bg-white border border-slate-200 px-2 py-1.5 text-center">
                      <p className="text-slate-400 text-[9px]">Salón {i + 1}</p>
                      <p className="font-bold text-slate-800">{sal.length}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleImprimirSalones}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white font-semibold text-sm shadow hover:bg-emerald-700 active:scale-95 transition-all"
              >
                <span>🖨</span> Imprimir / Guardar PDF
              </button>
            </>
          )}

          <p className="text-[10px] text-slate-300 max-w-xs">
            Se abrirá una nueva ventana con un salón por página. En el diálogo de impresión puede elegir "Guardar como PDF".
          </p>
        </div>
      )}
    </div>
  );
}
