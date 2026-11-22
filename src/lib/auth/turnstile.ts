export type TurnstileOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
  "response-field": false;
  theme: "auto";
  size: "compact";
};

export type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileOptions) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

/** Load the provider's official script once. A failed load can be retried. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    let finished = false;
    const finish = (api?: TurnstileApi) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (api) resolve(api);
      else {
        loading = undefined;
        script.remove();
        reject(new Error("The security check could not load."));
      }
    };
    const timer = setTimeout(() => finish(), 15000);
    script.onload = () => finish(window.turnstile);
    script.onerror = () => finish();
    document.head.appendChild(script);
  });
  return loading;
}
