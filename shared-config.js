(function initSharedConfig(globalScope) {
  const DEFAULTS = Object.freeze({
    keyColor: '#FF8C00',
    strColor: '#F0FFF0',
    numColor: '#77c78a',
    boolColor: '#7bbf8e',
    showPanel: true,
    showDomainList: true,
    showNameList: true,
    showTotalSellers: true,
    showUniqueSellers: true,
    showInvalidDomains: true,
    showInvalidAds: true,
    showInvalidAppAds: true,
    showTotalInvalid: true,
    showTotalFound: true,
    theme: 'dark'
  });

  globalScope.SELLERS_INSPECTOR_DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : self);
