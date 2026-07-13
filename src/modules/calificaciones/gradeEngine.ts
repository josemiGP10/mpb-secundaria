// ============================================================
//  MOTOR DE CALIFICACIONES — Escala 1.0 a 10.0
//
//  Dos fórmulas según el tipo de área:
//
//  BÁSICA:
//    Cognitivo     60% (promedio aritmético de N notas)
//    Prueba Inst.  20% (examen único de fin de periodo)
//    Social        10%
//    Personal      10%
//
//  COMPLEMENTARIA:
//    Cognitivo     80% (promedio aritmético de N notas)
//    Social        10%
//    Personal      10%
// ============================================================

import type { TipoAsignatura } from '@/db/types';

// ── Tipos de entrada ───────────────────────────────────────

export interface InputBasica {
  tipo: 'BASICA';
  notasCognitivas: number[];      // mínimo 1 elemento
  pruebaInstitucional: number;
  notaSocial: number;
  notaPersonal: number;
}

export interface InputComplementaria {
  tipo: 'COMPLEMENTARIA';
  notasCognitivas: number[];      // mínimo 1 elemento
  notaSocial: number;
  notaPersonal: number;
}

export type GradeInput = InputBasica | InputComplementaria;

// ── Resultado ──────────────────────────────────────────────

export interface GradeResult {
  promedio_cognitivo: number;
  nota_final: number;
  desglose: {
    cognitivo_ponderado: number;
    prueba_ponderada?: number;
    social_ponderado: number;
    personal_ponderado: number;
  };
}

// ── Validaciones ───────────────────────────────────────────

const ESCALA_MIN = 1.0;
const ESCALA_MAX = 10.0;

/** Lanza si el valor está fuera de la escala permitida. */
function assertEscala(valor: number, campo: string): void {
  if (valor < ESCALA_MIN || valor > ESCALA_MAX) {
    throw new RangeError(
      `El campo "${campo}" tiene valor ${valor}, fuera de la escala ${ESCALA_MIN}–${ESCALA_MAX}.`,
    );
  }
}

/** Redondea a 1 decimal y clampea a [1.0, 10.0]. */
function redondear(valor: number): number {
  const clamped = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, valor));
  return Math.round(clamped * 10) / 10;
}

/** Promedio aritmético simple. */
function promedio(notas: number[]): number {
  if (notas.length === 0) throw new Error('El componente cognitivo requiere al menos una nota.');
  return notas.reduce((acc, n) => acc + n, 0) / notas.length;
}

// ── Función principal ──────────────────────────────────────

export function calcularNota(input: GradeInput): GradeResult {
  // Validar todas las notas cognitivas
  input.notasCognitivas.forEach((n, i) => assertEscala(n, `notasCognitivas[${i}]`));
  assertEscala(input.notaSocial,    'notaSocial');
  assertEscala(input.notaPersonal,  'notaPersonal');

  const avgCognitivo = promedio(input.notasCognitivas);

  if (input.tipo === 'BASICA') {
    assertEscala(input.pruebaInstitucional, 'pruebaInstitucional');

    const cogPonderado    = avgCognitivo              * 0.60;
    const pruebaPonderada = input.pruebaInstitucional * 0.20;
    const socialPonderado = input.notaSocial          * 0.10;
    const persoPonderado  = input.notaPersonal        * 0.10;

    const notaFinal = redondear(
      cogPonderado + pruebaPonderada + socialPonderado + persoPonderado,
    );

    return {
      promedio_cognitivo: redondear(avgCognitivo),
      nota_final: notaFinal,
      desglose: {
        cognitivo_ponderado:  redondear(cogPonderado),
        prueba_ponderada:     redondear(pruebaPonderada),
        social_ponderado:     redondear(socialPonderado),
        personal_ponderado:   redondear(persoPonderado),
      },
    };
  }

  // COMPLEMENTARIA
  const cogPonderado    = avgCognitivo     * 0.80;
  const socialPonderado = input.notaSocial * 0.10;
  const persoPonderado  = input.notaPersonal * 0.10;

  const notaFinal = redondear(
    cogPonderado + socialPonderado + persoPonderado,
  );

  return {
    promedio_cognitivo: redondear(avgCognitivo),
    nota_final: notaFinal,
    desglose: {
      cognitivo_ponderado: redondear(cogPonderado),
      social_ponderado:    redondear(socialPonderado),
      personal_ponderado:  redondear(persoPonderado),
    },
  };
}

// ── Helpers para UI ────────────────────────────────────────

/** Clasifica la nota según los rangos de la institución. */
export function clasificarNota(nota: number): {
  etiqueta: string;
  color: string;
} {
  if (nota >= 9.0) return { etiqueta: 'Desempeño Superior',  color: 'text-emerald-400' };
  if (nota >= 7.5) return { etiqueta: 'Desempeño Alto',      color: 'text-blue-400'    };
  if (nota >= 6.0) return { etiqueta: 'Desempeño Básico',    color: 'text-yellow-400'  };
  return             { etiqueta: 'Desempeño Bajo',      color: 'text-red-400'     };
}

/** Construye el GradeInput correcto según el tipo de área, con defaults seguros. */
export function buildGradeInput(
  tipo: TipoAsignatura,
  notasCognitivas: number[],
  pruebaInstitucional: number | undefined,
  notaSocial: number,
  notaPersonal: number,
): GradeInput {
  if (tipo === 'BASICA') {
    return {
      tipo: 'BASICA',
      notasCognitivas,
      pruebaInstitucional: pruebaInstitucional ?? ESCALA_MIN,
      notaSocial,
      notaPersonal,
    };
  }
  return {
    tipo: 'COMPLEMENTARIA',
    notasCognitivas,
    notaSocial,
    notaPersonal,
  };
}
