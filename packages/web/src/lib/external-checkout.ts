type CheckoutNavigationTarget = 'new_tab' | 'top_window' | 'current_window';

function openExternalUrl(url: string): CheckoutNavigationTarget {
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (popup) {
    popup.focus();
    return 'new_tab';
  }

  try {
    if (window.top && window.top !== window.self) {
      window.top.location.assign(url);
      return 'top_window';
    }
  } catch {
    // Cross-origin embed policies can block top-level navigation.
  }

  window.location.assign(url);
  return 'current_window';
}

export function reserveCheckoutWindow() {
  let popup: Window | null = null;

  try {
    popup = window.open('', '_blank');
  } catch {
    popup = null;
  }

  if (popup) {
    try {
      popup.document.title = 'Opening secure checkout';
      popup.document.body.style.fontFamily = 'Inter, system-ui, sans-serif';
      popup.document.body.style.margin = '0';
      popup.document.body.style.minHeight = '100vh';
      popup.document.body.style.display = 'grid';
      popup.document.body.style.placeItems = 'center';
      popup.document.body.textContent = 'Opening secure checkout...';
      popup.opener = null;
    } catch {
      // The tab is still usable even when the placeholder cannot be written.
    }
  }

  return {
    open(url: string): CheckoutNavigationTarget {
      if (popup && !popup.closed) {
        try {
          popup.location.assign(url);
          popup.focus();
          return 'new_tab';
        } catch {
          popup = null;
        }
      }

      return openExternalUrl(url);
    },
    close() {
      if (popup && !popup.closed) {
        popup.close();
      }
      popup = null;
    },
  };
}
