type RoborevConfigurationListener = () => void;

const listeners = new Set<RoborevConfigurationListener>();

export function onRoborevConfigurationChanged(
  listener: RoborevConfigurationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyRoborevConfigurationChanged(): void {
  for (const listener of listeners) listener();
}
