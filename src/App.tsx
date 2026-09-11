import { useEffect, useState } from 'react';
import { importarDesdeSupabase, respaldarASupabase, getUltimoRespaldo } from './db/syncService';
import { CalificacionesView } from './modules/calificaciones/CalificacionesView';
import { AsistenciaView } from './modules/asistencia/AsistenciaView';
import { SecuenciasView } from './modules/secuencias/SecuenciasView';
import { ReportesView } from './modules/reportes/ReportesView';

type Screen = 'home' | 'asistencia' | 'calificaciones' | 'secuencias' | 'reportes';

interface NavItem { id: Screen; label: string; icon: string; }
const NAV_ITEMS: NavItem[] = [
  { id: 'home',           label: 'Inicio',   icon: '⌂' },
  { id: 'asistencia',     label: 'Asist.',   icon: '✓' },
  { id: 'calificaciones', label: 'Notas',    icon: '✎' },
  { id: 'secuencias',     label: 'Secuenc.', icon: '⊞' },
  { id: 'reportes',       label: 'Reporte',  icon: '🖨' },
];

export function App() {
  const [screen,          setScreen]          = useState<Screen>('home');
  const [dbReady,         setDbReady]         = useState(false);
  const [importando,      setImportando]      = useState(false);
  const [respaldando,     setRespaldando]     = useState(false);
  const [enLinea,         setEnLinea]         = useState(navigator.onLine);
  const [ultimoRespaldo,  setUltimoRespaldo]  = useState<string | null>(getUltimoRespaldo);
  const [importError,     setImportError]     = useState<string | null>(null);
  const [respaldoError,   setRespaldoError]   = useState<string | null>(null);

  // ── Inicialización: importar de Supabase SOLO si este equipo no
  //    tiene datos locales todavía (primera vez). Después de eso, la
  //    app trabaja 100% local, sin depender de internet para nada.
  useEffect(() => {
    const init = async () => {
      const { db } = await import('./db/database');
      const tieneDatos = (await db.grupos.count()) > 0;

      if (!tieneDatos) {
        if (!navigator.onLine) {
          setImportError('Este equipo no tiene datos todavía y no hay internet. Conéctese una vez para traer la información inicial.');
          setDbReady(true);
          return;
        }
        setImportando(true);
        try {
          const res = await importarDesdeSupabase();
          if (!res.ok) setImportError(res.errores.join(' | '));
        } catch (e) {
          setImportError(String(e));
        } finally {
          setImportando(false);
        }
      }

      setDbReady(true);
    };
    init().catch(console.error);
  }, []);

  // Solo para mostrar el indicador de conexión (ya no dispara nada automático)
  useEffect(() => {
    const handleOnline  = () => setEnLinea(true);
    const handleOffline = () => setEnLinea(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Respaldo manual ─────────────────────────────────────────
  const handleRespaldar = async () => {
    if (respaldando || !enLinea) return;
    setRespaldando(true);
    setRespaldoError(null);
    try {
      const res = await respaldarASupabase();
      if (res.ok) setUltimoRespaldo(res.ts);
      else setRespaldoError(res.errores.join(' | '));
    } catch (e) {
      setRespaldoError(String(e));
    } finally {
      setRespaldando(false);
    }
  };

  // ── Pantalla de carga / importación inicial ────────────────
  if (!dbReady) {
    return (
      <div className="flex items-center justify-center bg-surface" style={{ height: '100dvh' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="IERMPB" className="w-16 h-16 object-contain opacity-70"
               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="w-10 h-10 rounded-full border-4 border-slate-300 border-t-blue-500 animate-spin" />
          <p className="text-slate-500 text-sm">
            {importando ? '☁ Trayendo datos iniciales (solo la primera vez)...' : 'Iniciando...'}
          </p>
        </div>
      </div>
    );
  }

  if (importError) {
    return (
      <div className="flex items-center justify-center bg-surface p-6 text-center" style={{ height: '100dvh' }}>
        <div className="max-w-xs flex flex-col gap-3">
          <p className="text-sm text-red-600 font-semibold">No se pudo traer la información inicial</p>
          <p className="text-xs text-slate-500">{importError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-surface overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2 bg-surface-card border-b border-surface-muted flex-shrink-0">
        <img src="/logo.png" alt="IERMPB" className="w-7 h-7 object-contain flex-shrink-0"
             onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-bold text-slate-900 truncate leading-none">
            <span className="hidden sm:inline">Diario Pedagógico — I.E.R. Miguel Pinedo Barros</span>
            <span className="sm:hidden">Diario Pedagógico MPB</span>
          </h1>
          <p className="text-[10px] text-slate-400 leading-none mt-0.5">
            J. Gonzalez · {new Date(__BUILD_TIME__).toLocaleString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
          </p>
        </div>

        {/* Indicador de conexión (informativo, no dispara nada) */}
        <div
          title={enLinea ? 'En línea' : 'Sin conexión a internet'}
          className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1"
        >
          <span className={`w-2 h-2 rounded-full ${enLinea ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
          <span className={`text-[10px] hidden sm:inline ${enLinea ? 'text-emerald-600' : 'text-slate-400'}`}>
            {enLinea ? 'En línea' : 'Sin internet'}
          </span>
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        {screen === 'home' && (
          <HomeScreen
            onNavigate={setScreen}
            enLinea={enLinea}
            respaldando={respaldando}
            ultimoRespaldo={ultimoRespaldo}
            respaldoError={respaldoError}
            onRespaldar={handleRespaldar}
          />
        )}
        {screen === 'asistencia'     && <AsistenciaView />}
        {screen === 'calificaciones' && <CalificacionesView />}
        {screen === 'secuencias'     && <SecuenciasView />}
        {screen === 'reportes'       && <ReportesView />}
      </main>

      {/* Nav inferior */}
      <nav
        className="flex border-t border-surface-muted bg-surface-card flex-shrink-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setScreen(item.id)}
            className={`
              flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5
              transition-colors touch-target
              ${screen === item.id
                ? 'text-blue-600 bg-blue-50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }
            `}
          >
            <span className="text-lg" aria-hidden>{item.icon}</span>
            <span className="text-[9px] font-medium leading-none">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────

function HomeScreen({
  onNavigate, enLinea, respaldando, ultimoRespaldo, respaldoError, onRespaldar,
}: {
  onNavigate: (s: Screen) => void;
  enLinea: boolean;
  respaldando: boolean;
  ultimoRespaldo: string | null;
  respaldoError: string | null;
  onRespaldar: () => void;
}) {
  return (
    <div className="p-6 flex flex-col gap-6">
      <section>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Diario Pedagógico</h2>
        <p className="text-sm text-slate-500">
          I.E. Rural Miguel Pinedo Barros · La Punta de los Remedios, Dibulla - La Guajira
        </p>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <ActionCard icon="✓" title="Asistencia"
          description="Control diario: Asiste, Falla Justificada, Falla Injustificada"
          onClick={() => onNavigate('asistencia')} />
        <ActionCard icon="✎" title="Notas"
          description="Calificaciones cognitivas, social y personal con cálculo automático"
          onClick={() => onNavigate('calificaciones')} />
        <ActionCard icon="⊞" title="Secuencias"
          description="Planeación didáctica y registro de cada sesión de clase"
          onClick={() => onNavigate('secuencias')} />
      </div>

      {/* Respaldo manual */}
      <div className="rounded-xl bg-slate-100 border border-slate-300 p-4 text-sm text-slate-700">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p className="font-semibold">💾 Todo funciona local en este equipo</p>
          <button
            onClick={onRespaldar}
            disabled={respaldando || !enLinea}
            title={enLinea ? 'Subir una copia de seguridad a la nube' : 'Necesita internet para respaldar'}
            className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {respaldando ? 'Respaldando...' : 'Respaldar ahora'}
          </button>
        </div>
        <p className="text-slate-500 text-xs">
          {respaldoError
            ? `Error al respaldar: ${respaldoError}`
            : ultimoRespaldo
              ? `Último respaldo: ${new Date(ultimoRespaldo).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : enLinea
                ? 'Toque "Respaldar ahora" para guardar una copia en la nube.'
                : 'Sin internet ahora — conéctese cuando pueda y toque "Respaldar ahora".'}
        </p>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, description, onClick }: {
  icon: string; title: string; description: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="text-left rounded-2xl p-5 flex flex-col gap-3 transition-all shadow-sm bg-surface-card border border-surface-muted hover:border-blue-400 hover:shadow-md hover:bg-blue-50 active:scale-95">
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="font-semibold text-sm text-slate-900">{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed text-slate-500">{description}</p>
      </div>
    </button>
  );
}
