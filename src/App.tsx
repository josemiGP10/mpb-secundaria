import { useEffect, useState } from 'react';
import { sembrarDatos } from './db/seed';
import { CalificacionesView } from './modules/calificaciones/CalificacionesView';
import { AsistenciaView } from './modules/asistencia/AsistenciaView';
import { SecuenciasView } from './modules/secuencias/SecuenciasView';

type Screen = 'home' | 'asistencia' | 'calificaciones' | 'secuencias';

interface NavItem { id: Screen; label: string; icon: string; }
const NAV_ITEMS: NavItem[] = [
  { id: 'home',           label: 'Inicio',     icon: '⌂' },
  { id: 'asistencia',     label: 'Asistencia', icon: '✓' },
  { id: 'calificaciones', label: 'Notas',      icon: '✎' },
  { id: 'secuencias',     label: 'Secuencias', icon: '⊞' },
];

export function App() {
  const [screen,   setScreen]   = useState<Screen>('home');
  const [dbReady,  setDbReady]  = useState(false);
  const [dbError,  setDbError]  = useState<string | null>(null);

  useEffect(() => {
    sembrarDatos()
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('Error al inicializar DB:', err);
        setDbError(String(err));
        setDbReady(true);
      });
  }, []);

  if (!dbReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo.png"
            alt="IERMPB"
            className="w-16 h-16 object-contain opacity-70"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="w-10 h-10 rounded-full border-4 border-slate-300 border-t-blue-500 animate-spin" />
          <p className="text-slate-500 text-sm">Cargando datos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Header compacto */}
      <header className="flex items-center gap-2 px-3 py-2 bg-surface-card border-b border-surface-muted flex-shrink-0">
        <img
          src="/logo.png"
          alt="IERMPB"
          className="w-7 h-7 object-contain flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-xs font-bold text-slate-900 truncate leading-none">
            <span className="hidden sm:inline">Diario Pedagógico — I.E.R. Miguel Pinedo Barros</span>
            <span className="sm:hidden">Diario Pedagógico MPB</span>
          </h1>
          <p className="text-[10px] text-slate-400 leading-none mt-0.5">J. Gonzalez · 2026</p>
        </div>
        {dbError && (
          <span className="text-[10px] text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Error BD</span>
        )}
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        {screen === 'home'           && <HomeScreen onNavigate={setScreen} />}
        {screen === 'asistencia'     && <AsistenciaView />}
        {screen === 'calificaciones' && <CalificacionesView />}
        {screen === 'secuencias'     && <SecuenciasView />}
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

function HomeScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  return (
    <div className="p-6 flex flex-col gap-6">
      <section>
        <h2 className="text-xl font-bold text-slate-900 mb-1">Diario Pedagógico</h2>
        <p className="text-sm text-slate-500">
          I.E. Rural Miguel Pinedo Barros · La Punta de los Remedios · 2026
        </p>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <ActionCard
          icon="✓"
          title="Asistencia"
          description="Control diario: Asiste, Falla Justificada, Falla Injustificada"
          onClick={() => onNavigate('asistencia')}
        />
        <ActionCard
          icon="✎"
          title="Notas"
          description="Calificaciones cognitivas, social y personal con cálculo automático"
          onClick={() => onNavigate('calificaciones')}
        />
        <ActionCard
          icon="⊞"
          title="Secuencias"
          description="Planeación didáctica y registro de cada sesión de clase"
          onClick={() => onNavigate('secuencias')}
        />
      </div>

      <div className="rounded-xl bg-slate-100 border border-slate-200 p-4 text-sm text-slate-600">
        <p className="font-semibold mb-0.5 text-slate-700">Modo 100% sin internet</p>
        <p className="text-slate-500 text-xs">
          Todos los datos se guardan solo en este dispositivo. No se requiere conexión.
        </p>
      </div>
    </div>
  );
}

function ActionCard({
  icon, title, description, onClick,
}: {
  icon: string; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl p-5 flex flex-col gap-3 transition-all shadow-sm bg-surface-card border border-surface-muted hover:border-blue-400 hover:shadow-md hover:bg-blue-50 active:scale-95"
    >
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="font-semibold text-sm text-slate-900">{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed text-slate-500">{description}</p>
      </div>
    </button>
  );
}
