chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchAds") {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(request.url, { signal: controller.signal })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("Not ok");
        return res.text();
      })
      .then(text => sendResponse({ text, success: true }))
      .catch(err => {
        clearTimeout(timeoutId);
        sendResponse({ text: null, success: false });
      });
    return true;
  }
});
