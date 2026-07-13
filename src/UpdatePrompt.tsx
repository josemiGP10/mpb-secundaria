import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_, reg) {
      // Verifica actualizaciones cada 60 s cuando la app está en foco
      if (reg) {
        setInterval(() => {
          if (document.visibilityState === 'visible') reg.update();
        }, 60_000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-safe">
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl bg-blue-700 px-4 py-3 shadow-2xl">
        <span className="text-sm text-white flex-1">Nueva versión disponible</span>
        <button
          onClick={() => updateServiceWorker(true)}
          className="rounded-xl bg-white px-4 py-1.5 text-sm font-semibold text-blue-700 active:scale-95 transition-transform"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}