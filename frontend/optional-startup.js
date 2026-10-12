// Join optional discovery with the first real scene without blocking either.
// A saved-session reconnect is attempted once; a failed attempt remains an
// explicit user retry, never a loop that steals page/audio ownership.
export function optionalStartup({ hasSession, connect, onError = () => {} }) {
  let simulation = false,
    speech = false,
    attempted = false,
    cancelled = false;
  const attempt = () => {
    if (cancelled || attempted || !simulation || !speech || !hasSession())
      return;
    attempted = true;
    Promise.resolve()
      .then(() => (cancelled ? undefined : connect()))
      .catch(onError);
  };
  return {
    simulationReady() {
      simulation = true;
      attempt();
    },
    speechReady() {
      speech = true;
      attempt();
    },
    cancel() {
      cancelled = true;
    },
  };
}
