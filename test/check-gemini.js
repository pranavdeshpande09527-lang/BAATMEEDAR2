const axios = require('axios');
const config = require('../src/config');

async function testGemini() {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${config.apis.gemini}`;
      const res = await axios.post(url, {
        contents: [{ role: 'user', parts: [{ text: 'Respond with JSON: {"status": "ok"}' }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }, { timeout: 8000 });
      console.log(`Model ${m}: SUCCESS ->`, res.data.candidates[0].content.parts[0].text);
      return m;
    } catch (e) {
      console.log(`Model ${m}: failed -> ${e.response?.status} ${e.response?.data?.error?.message || e.message}`);
    }
  }
}
testGemini();
