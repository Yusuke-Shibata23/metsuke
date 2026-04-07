module.exports = {
  timeout: {
    goto: 30000,      // page.goto タイムアウト
    element: 3000,    // elements_exist の waitFor
    action: 5000,     // toggle / navigation / form のクリック・waitFor
    pageLoad: 1000,   // ページロード後の固定待機
    navReturn: 500,   // link_navigation 戻り後の待機
    hoverWait: 300,   // hover後のドロップダウン展開待ち
  },
  browser: {
    slowMo: 500,      // 非headlessモードのslowMo（ms）
  },
};
