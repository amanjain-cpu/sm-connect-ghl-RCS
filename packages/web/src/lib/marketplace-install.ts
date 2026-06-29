const crmMarketplaceHostSuffixes = [
  `.${['go', 'high', 'level'].join('')}.com`,
  `.${['lead', 'connector', 'hq'].join('')}.com`,
];

function isTrustedCrmUrl(url: URL): boolean {
  return crmMarketplaceHostSuffixes.some((hostnameSuffix) => url.hostname.endsWith(hostnameSuffix));
}

function isGenericCrmHomeUrl(url: URL): boolean {
  return isTrustedCrmUrl(url) && url.pathname === '/' && !url.search && !url.hash;
}

export function getMarketplaceReturnUrl(explicitReturnUrl?: string | null): string | null {
  if (!explicitReturnUrl) {
    return null;
  }

  try {
    const returnUrl = new URL(explicitReturnUrl);
    if (isTrustedCrmUrl(returnUrl) && !isGenericCrmHomeUrl(returnUrl)) {
      return returnUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function finishMarketplaceInstallTab(options?: {
  explicitReturnUrl?: string | null;
  onStayOpen?: () => void;
}): void {
  const returnUrl = getMarketplaceReturnUrl(options?.explicitReturnUrl);
  if (returnUrl) {
    window.location.replace(returnUrl);
    return;
  }

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.focus();
    } catch {
      // Ignore focus failures before closing the install tab.
    }
  }

  try {
    window.close();
  } catch {
    // Ignore close failures and fall through to manual-close fallback.
  }

  window.setTimeout(() => {
    if (window.closed) {
      return;
    }

    try {
      window.open('', '_self');
      window.close();
    } catch {
      // Ignore close fallback failures and show the manual-close state.
    }

    window.setTimeout(() => {
      if (!window.closed) {
        options?.onStayOpen?.();
      }
    }, 150);
  }, 150);
}
