function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('frontend/index')
      .evaluate()
      .setTitle('GAS SPA App')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    return HtmlService.createHtmlOutput('<h2>Error loading app</h2><p>' + error.message + '</p>');
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
