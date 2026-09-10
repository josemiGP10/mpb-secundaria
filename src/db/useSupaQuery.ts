import { useEffect, useState } from 'react';

/**
 * Reemplazo de useLiveQuery (dexie-react-hooks) para el modo 100% en línea.
 * Misma firma (fetcher + deps), pero sin reactividad automática entre
 * escrituras: cada vista que necesite refrescar tras un cambio debe volver
 * a disparar el fetch (cambiando algo en `deps`, o llamando su propio
 * recargar/refetch como ya hacían varias pantallas).
 */
export function useSupaQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(() => {
    let cancelado = false;
    fetcher()
      .then((r) => { if (!cancelado) setData(r); })
      .catch((e) => { console.error(e); if (!cancelado) setData(undefined); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return data;
}
