function test() {
  const payload = {
    cardsV2: [
      {
        cardId: "test",
        card: {
          header: { title: "Test" },
          sections: [{ widgets: [{ textParagraph: { text: "Hello" } }] }]
        }
      }
    ]
  };
  console.log(JSON.stringify(payload));
}
test();
