(function initSharedConfig(globalScope) {
  const DEFAULTS = Object.freeze({
    darkThemeColors: Object.freeze({
      keyColor: '#FF8C00',
      strColor: '#F0FFF0',
      numColor: '#77c78a',
      boolColor: '#7bbf8e'
    }),
    lightThemeColors: Object.freeze({
      keyColor: '#005FB8',
      strColor: '#A31515',
      numColor: '#0B7A0B',
      boolColor: '#7A4E00'
    }),
    showPanel: true,
    showDomainList: true,
    showNameList: true,
    showTotalSellers: true,
    showUniqueSellers: true,
    showInvalidDomains: true,
    showInvalidAds: true,
    showInvalidAppAds: true,
    showTotalInvalid: true,
    showTotalFound: true
  });

  globalScope.SELLERS_INSPECTOR_DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : self);