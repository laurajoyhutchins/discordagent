type RoborevConfigurationListener = () => void;

const listeners = new Set<RoborevConfigurationListener>();

// Project commands publish this signal after persistence changes so the
// in-process watcher reconciles its process without importing command code.
export function onRoborevConfigurationChanged(
  listener: RoborevConfigurationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyRoborevConfigurationChanged(): void {
  for (const listener of listeners) listener();
}
