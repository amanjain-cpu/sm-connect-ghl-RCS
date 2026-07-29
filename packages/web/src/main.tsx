import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { sanitizePlatformBranding } from './lib/platform-branding';
import './styles/globals.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);
let bootstrapComplete = false;

function FatalStartupError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-8 shadow-pop">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">Startup Error</p>
        <h1 className="mt-4 text-2xl font-semibold">The app failed before it could render.</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The frontend threw during startup. The message below is the actual browser error captured at boot.
        </p>
        <pre className="mt-6 overflow-x-auto rounded-2xl border border-border bg-muted/60 p-4 text-sm text-foreground">
          {message}
        </pre>
      </div>
    </div>
  );
}

function renderFatalError(error: unknown) {
  const message =
    error instanceof Error
      ? sanitizePlatformBranding(`${error.name}: ${error.message}`)
      : typeof error === 'string'
        ? sanitizePlatformBranding(error)
        : JSON.stringify(error, null, 2);

  root.render(
    <React.StrictMode>
      <FatalStartupError message={message} />
    </React.StrictMode>
  );
}

function handleGlobalError(error: unknown) {
  if (!bootstrapComplete) {
    renderFatalError(error);
    return;
  }

  console.error('Unhandled runtime error after app bootstrap', error);
}

window.addEventListener('error', (event) => {
  handleGlobalError(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  handleGlobalError(event.reason);
});

async function bootstrap() {
  try {
    const [{ default: App }, { Toaster }] = await Promise.all([
      import('./App'),
      import('./components/ui/toaster'),
    ]);

    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
          <Toaster />
        </BrowserRouter>
      </React.StrictMode>
    );
    bootstrapComplete = true;
  } catch (error) {
    renderFatalError(error);
  }
}

void bootstrap();
