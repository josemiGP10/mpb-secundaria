-- ============================================================
--  SCHEMA — Diario Pedagógico MPB Secundaria
--  Pegar en: Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Catálogo

create table if not exists areas (
  id          text primary key,
  nombre      text not null,
  tipo        text not null,   -- 'BASICA' | 'COMPLEMENTARIA'
  created_at  text not null,
  updated_at  text not null
);

create table if not exists asignaturas (
  id           text primary key,
  area_id      text not null references areas(id),
  nombre       text not null,
  horas_semana integer not null default 2,
  created_at   text not null,
  updated_at   text not null
);

create table if not exists grupos (
  id           text primary key,
  anio         integer not null,
  nombre       text not null,
  grado_cod    integer not null,
  num_periodos integer not null default 4,
  created_at   text not null,
  updated_at   text not null
);

create table if not exists grupo_asignaturas (
  id            text primary key,
  grupo_id      text not null references grupos(id),
  asignatura_id text not null references asignaturas(id),
  created_at    text not null,
  updated_at    text not null
);

-- Estudiantes y matrículas

create table if not exists estudiantes (
  id                text primary key,
  tipo_doc          text not null,
  doc               text not null,
  apellido1         text not null,
  apellido2         text not null default '',
  nombre1           text not null,
  nombre2           text not null default '',
  fecha_nacimiento  text not null,
  created_at        text not null,
  updated_at        text not null
);

create table if not exists matriculas (
  id             text primary key,
  estudiante_id  text not null references estudiantes(id),
  grupo_id       text not null references grupos(id),
  anio           integer not null,
  activo         boolean not null default true,
  created_at     text not null,
  updated_at     text not null
);

-- Calificaciones

create table if not exists actividades_cognitivas (
  id            text primary key,
  grupo_id      text not null references grupos(id),
  asignatura_id text not null references asignaturas(id),
  periodo       integer not null,
  anio          integer not null,
  nombre        text not null,
  orden         integer not null default 0,
  created_at    text not null,
  updated_at    text not null
);

create table if not exists calificaciones (
  id                    text primary key,
  matricula_id          text not null references matriculas(id),
  asignatura_id         text not null references asignaturas(id),
  periodo               integer not null,
  anio                  integer not null,
  prueba_institucional  real,
  nota_social           real not null default 5.0,
  nota_personal         real not null default 5.0,
  nota_final            real,
  created_at            text not null,
  updated_at            text not null
);

create table if not exists notas_cognitivas (
  id              text primary key,
  calificacion_id text not null references calificaciones(id),
  actividad_id    text references actividades_cognitivas(id),
  valor           real not null,
  created_at      text not null
);

-- Asistencia

create table if not exists registros_asistencia (
  id            text primary key,
  matricula_id  text not null references matriculas(id),
  asignatura_id text not null references asignaturas(id),
  fecha         text not null,
  hora_bloque   integer not null default 1,
  estado        text not null,   -- 'ASISTE' | 'FJ' | 'FI'
  created_at    text not null
);

-- Secuencias didácticas

create table if not exists secuencias (
  id            text primary key,
  titulo        text not null,
  grupo_id      text not null references grupos(id),
  asignatura_id text not null references asignaturas(id),
  periodo       integer not null,
  anio          integer not null,
  pregunta      text not null default '',
  objetivo      text not null default '',
  competencias  text not null default '',
  criterios     text not null default '',
  estado        text not null default 'BORRADOR',  -- 'BORRADOR' | 'ACTIVA' | 'COMPLETADA'
  created_at    text not null,
  updated_at    text not null
);

create table if not exists sesiones (
  id               text primary key,
  secuencia_id     text not null references secuencias(id),
  orden            integer not null,
  titulo           text not null default '',
  inicio           text not null default '',
  desarrollo       text not null default '',
  cierre           text not null default '',
  recursos         text not null default '',
  duracion_bloques integer not null default 1,
  completada       boolean not null default false,
  created_at       text not null,
  updated_at       text not null
);

create table if not exists registros_clase (
  id             text primary key,
  sesion_id      text references sesiones(id),
  grupo_id       text not null references grupos(id),
  asignatura_id  text not null references asignaturas(id),
  fecha          text not null,
  momento        text not null default 'COMPLETA',
  nota_breve     text not null default '',
  pendiente      text not null default '',
  tarea_desc     text not null default '',
  tarea_fecha    text not null default '',
  hubo_actividad boolean not null default false,
  created_at     text not null,
  updated_at     text not null
);

-- ── Políticas RLS (Row Level Security) ─────────────────────
-- Permitir lectura y escritura pública (anon key).
-- La app no tiene autenticación de usuarios.

alter table areas                  enable row level security;
alter table asignaturas            enable row level security;
alter table grupos                 enable row level security;
alter table grupo_asignaturas      enable row level security;
alter table estudiantes            enable row level security;
alter table matriculas             enable row level security;
alter table actividades_cognitivas enable row level security;
alter table calificaciones         enable row level security;
alter table notas_cognitivas       enable row level security;
alter table registros_asistencia   enable row level security;
alter table secuencias             enable row level security;
alter table sesiones               enable row level security;
alter table registros_clase        enable row level security;

-- Políticas: acceso total con anon key
do $$ declare t text; begin
  foreach t in array array[
    'areas','asignaturas','grupos','grupo_asignaturas',
    'estudiantes','matriculas','actividades_cognitivas',
    'calificaciones','notas_cognitivas','registros_asistencia',
    'secuencias','sesiones','registros_clase'
  ] loop
    execute format('create policy "allow_all_%s" on %I for all to anon using (true) with check (true)', t, t);
  end loop;
end $$;
