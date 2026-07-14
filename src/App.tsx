import { useEffect, useState } from 'react';
import { sembrarDatos } from './db/seed';
import { sincronizarCompleto, sincronizarBajada, getUltimaSync } from './db/syncService';
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
  const [screen,        setScreen]        = useState<Screen>('home');
  const [dbReady,       setDbReady]       = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [enLinea,       setEnLinea]       = useState(navigator.onLine);
  const [ultimaSync,    setUltimaSync]    = useState<string | null>(getUltimaSync);
  const [syncError,     setSyncError]     = useState(false);

  // ── Inicialización: seed + primera bajada si no hay datos ─
  useEffect(() => {
    const init = async () => {
      await sembrarDatos();

      // Si es un dispositivo nuevo (sin grupos en local) y hay internet → bajar todo
      const { db } = await import('./db/database');
      const grupos = await db.grupos.count();
      if (grupos === 0 && navigator.onLine) {
        setSincronizando(true);
        try {
          const res = await sincronizarBajada();
          if (res.ok) setUltimaSync(res.ts);
          else setSyncError(true);
        } catch { setSyncError(true); }
        finally { setSincronizando(false); }
      }

      setDbReady(true);
    };
    init().catch(console.error);
  }, []);

  // ── Auto-sync al reconectar ───────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const handleOnline = () => {
      setEnLinea(true);
      setSyncError(false);
      timer = setTimeout(async () => {
        if (!navigator.onLine) return;
        setSincronizando(true);
        try {
          const res = await sincronizarCompleto();
          if (res.ok) setUltimaSync(res.ts);
          else setSyncError(true);
        } catch { setSyncError(true); }
        finally { setSincronizando(false); }
      }, 2000);
    };

    const handleOffline = () => { setEnLinea(false); clearTimeout(timer); };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearTimeout(timer);
    };
  }, []);

  // ── Sync manual ───────────────────────────────────────────
  const handleSyncManual = async () => {
    if (sincronizando || !enLinea) return;
    setSincronizando(true);
    setSyncError(false);
    try {
      const res = await sincronizarCompleto();
      if (res.ok) setUltimaSync(res.ts);
      else setSyncError(true);
    } catch { setSyncError(true); }
    finally { setSincronizando(false); }
  };

  // ── Pantalla de carga ─────────────────────────────────────
  if (!dbReady) {
    return (
      <div className="flex items-center justify-center bg-surface" style={{ height: '100dvh' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="IERMPB" className="w-16 h-16 object-contain opacity-70"
               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="w-10 h-10 rounded-full border-4 border-slate-300 border-t-blue-500 animate-spin" />
          <p className="text-slate-500 text-sm">
            {sincronizando ? '☁ Descargando datos...' : 'Iniciando...'}
          </p>
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
          <p className="text-[10px] text-slate-400 leading-none mt-0.5">J. Gonzalez · 2026</p>
        </div>

        {/* Indicador de sync */}
        <button
          onClick={handleSyncManual}
          disabled={sincronizando || !enLinea}
          title={enLinea ? 'Sincronizar ahora' : 'Sin conexión'}
          className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 rounded-lg transition-colors disabled:opacity-60"
        >
          {sincronizando ? (
            <span className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          ) : syncError ? (
            <span className="text-red-500 text-sm" title="Error al sincronizar — toque para reintentar">⚠</span>
          ) : enLinea ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-400" />
          )}
          <span className={`text-[10px] hidden sm:inline ${
            syncError ? 'text-red-500' : enLinea ? 'text-emerald-600' : 'text-slate-400'
          }`}>
            {sincronizando ? 'Sync...' : syncError ? 'Error' : enLinea ? 'En línea' : 'Sin internet'}
          </span>
        </button>
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        {screen === 'home'           && <HomeScreen onNavigate={setScreen} enLinea={enLinea} ultimaSync={ultimaSync} sincronizando={sincronizando} onSync={handleSyncManual} />}
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
  onNavigate, enLinea, ultimaSync, sincronizando, onSync,
}: {
  onNavigate: (s: Screen) => void;
  enLinea: boolean;
  ultimaSync: string | null;
  sincronizando: boolean;
  onSync: () => void;
}) {
  return (
    <div className="p-6 flex flex-col gap-6">
      <section>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Diario Pedagógico</h2>
        <p className="text-sm text-slate-500">
          I.E. Rural Miguel Pinedo Barros · La Punta de los Remedios · 2026
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

      {/* Estado de sincronización */}
      {sincronizando ? (
        <div className="rounded-xl bg-violet-50 border border-violet-200 p-4 text-sm text-violet-700 flex items-center gap-3">
          <span className="w-4 h-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin flex-shrink-0" />
          <div>
            <p className="font-semibold">Sincronizando con la nube…</p>
            <p className="text-violet-500 text-xs mt-0.5">Sus datos se están guardando en Supabase</p>
          </div>
        </div>
      ) : enLinea ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-700">
          <div className="flex items-center justify-between mb-0.5">
            <p className="font-semibold">☁ Conectado — datos sincronizados</p>
            <button onClick={onSync}
              className="text-[10px] px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors">
              Sync manual
            </button>
          </div>
          <p className="text-emerald-600 text-xs">
            {ultimaSync
              ? `Última sync: ${new Date(ultimaSync).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : 'Toque "Sync manual" para subir sus datos ahora'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-100 border border-slate-300 p-4 text-sm text-slate-600">
          <p className="font-semibold mb-0.5 text-slate-700">Sin conexión — modo offline</p>
          <p className="text-slate-500 text-xs">
            {ultimaSync
              ? `Última sync: ${new Date(ultimaSync).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · Al recuperar señal sincronizará automáticamente`
              : 'Al conectarse a internet se sincronizará automáticamente'}
          </p>
        </div>
      )}
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
