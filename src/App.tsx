import { useEffect, useState } from 'react';
import { supabaseConfigurado } from './lib/supabase';
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
  const [screen,  setScreen]  = useState<Screen>('home');
  const [enLinea, setEnLinea] = useState(navigator.onLine);

  // App 100% en línea: sin copia local ni sincronización — cada pantalla
  // lee y escribe directo en Supabase. Solo mostramos si hay internet.
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

  if (!supabaseConfigurado) {
    return (
      <div className="flex items-center justify-center bg-surface p-6 text-center" style={{ height: '100dvh' }}>
        <p className="text-sm text-red-600">
          Supabase no está configurado. Contacte al desarrollador.
        </p>
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

        {/* Indicador de conexión */}
        <div
          title={enLinea ? 'En línea' : 'Sin conexión a internet'}
          className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1"
        >
          <span className={`w-2 h-2 rounded-full ${enLinea ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-[10px] hidden sm:inline ${enLinea ? 'text-emerald-600' : 'text-red-500'}`}>
            {enLinea ? 'En línea' : 'Sin internet'}
          </span>
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        {screen === 'home'           && <HomeScreen onNavigate={setScreen} enLinea={enLinea} />}
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
  onNavigate, enLinea,
}: {
  onNavigate: (s: Screen) => void;
  enLinea: boolean;
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

      {!enLinea && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          <p className="font-semibold mb-0.5">Sin conexión a internet</p>
          <p className="text-red-600 text-xs">
            Esta app funciona en línea — necesita internet para ver y guardar datos.
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
