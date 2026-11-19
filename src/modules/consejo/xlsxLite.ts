// ============================================================
//  Lector mínimo de .xlsx (sin dependencias)
//  Un .xlsx es un ZIP con XML adentro. Se lee el directorio del
//  ZIP, se descomprime con DecompressionStream (nativo del
//  navegador) y se arma la PRIMERA hoja como matriz de celdas.
//  Suficiente para los consolidados que exporta la plataforma.
// ============================================================

export type Celda = string | number | null;

interface EntradaZip { metodo: number; tamComp: number; offset: number }

function leerDirectorioZip(buf: ArrayBuffer): Map<string, EntradaZip> {
  const dv = new DataView(buf);
  // Buscar el "End of Central Directory" desde el final
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no parece un Excel (.xlsx) válido.');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const mapa = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo   = dv.getUint16(p + 10, true);
    const tamComp  = dv.getUint32(p + 20, true);
    const largoNom = dv.getUint16(p + 28, true);
    const largoExt = dv.getUint16(p + 30, true);
    const largoCom = dv.getUint16(p + 32, true);
    const offset   = dv.getUint32(p + 42, true);
    const nombre   = dec.decode(new Uint8Array(buf, p + 46, largoNom));
    mapa.set(nombre, { metodo, tamComp, offset });
    p += 46 + largoNom + largoExt + largoCom;
  }
  return mapa;
}

async function leerArchivoZip(buf: ArrayBuffer, e: EntradaZip): Promise<string> {
  const dv = new DataView(buf);
  const inicio = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const datos = new Uint8Array(buf, inicio, e.tamComp);
  if (e.metodo === 0) return new TextDecoder().decode(datos);
  if (e.metodo !== 8) throw new Error(`Compresión ZIP no soportada (${e.metodo}).`);
  const stream = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function colAIndice(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

export interface HojaLeida { nombre: string; filas: Celda[][] }

/** Devuelve todas las hojas del libro (en su orden) como filas de celdas. */
export async function leerHojas(file: File): Promise<HojaLeida[]> {
  const buf = await file.arrayBuffer();
  const zip = leerDirectorioZip(buf);
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const leer = async (ruta: string) => {
    const e = zip.get(ruta);
    return e ? leerArchivoZip(buf, e) : null;
  };

  // Hojas en el orden del libro, ubicadas a través de workbook.xml + relaciones
  const hojas: { nombre: string; ruta: string }[] = [];
  const wb = await leer('xl/workbook.xml');
  const rels = await leer('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const relaciones = [...xml(rels).getElementsByTagName('Relationship')];
    for (const h of xml(wb).getElementsByTagName('sheet')) {
      const rid = h.getAttribute('r:id')
        ?? h.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const target = relaciones.find(r => r.getAttribute('Id') === rid)?.getAttribute('Target');
      if (!target) continue;
      hojas.push({
        nombre: h.getAttribute('name') ?? '',
        ruta: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`,
      });
    }
  }
  if (hojas.length === 0) hojas.push({ nombre: 'Hoja1', ruta: 'xl/worksheets/sheet1.xml' });

  const compartidas: string[] = [];
  const ss = await leer('xl/sharedStrings.xml');
  if (ss) {
    for (const si of xml(ss).getElementsByTagName('si')) {
      compartidas.push([...si.getElementsByTagName('t')].map(t => t.textContent ?? '').join(''));
    }
  }

  const resultado: HojaLeida[] = [];
  for (const h of hojas) {
    const hojaXml = await leer(h.ruta);
    if (!hojaXml) continue;
    const filas: Celda[][] = [];
    for (const row of xml(hojaXml).getElementsByTagName('row')) {
      const r = Number(row.getAttribute('r')) - 1;
      const fila: Celda[] = [];
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') ?? '';
        const col = ref ? colAIndice(ref) : fila.length;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent ?? null;
        let valor: Celda = null;
        if (t === 's' && v !== null) valor = compartidas[Number(v)] ?? '';
        else if (t === 'inlineStr') valor = [...c.getElementsByTagName('t')].map(x => x.textContent ?? '').join('');
        else if (t === 'str' || t === 'b' || t === 'e') valor = v;
        else if (v !== null && v !== '') valor = Number(v);
        fila[col] = valor;
      }
      for (let i = 0; i < fila.length; i++) if (fila[i] === undefined) fila[i] = null;
      filas[r >= 0 ? r : filas.length] = fila;
    }
    for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
    resultado.push({ nombre: h.nombre, filas });
  }
  if (resultado.length === 0) throw new Error('No se encontró ninguna hoja de cálculo dentro del archivo.');
  return resultado;
}

/** Devuelve la primera hoja del libro como filas de celdas. */
export async function leerPrimeraHoja(file: File): Promise<Celda[][]> {
  return (await leerHojas(file))[0].filas;
}
