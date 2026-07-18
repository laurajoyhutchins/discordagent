type RoborevConfigurationListener = () => void;

const listeners = new Set<RoborevConfigurationListener>();

// Project commands publish this signal after persistence changes so the
// in-process watcher can start or stop without coupling commands to its process.
export function onRoborevConfigurationChanged(
  listener: RoborevConfigurationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyRoborevConfigurationChanged(): void {
  for (const listener of listeners) listener();
}
