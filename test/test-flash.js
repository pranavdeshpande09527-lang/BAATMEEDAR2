const axios = require('axios');
const config = require('../src/config');

async function test() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${config.apis.gemini}`;
  const res = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: 'Extract atomic factual claim as JSON: "The RBI kept repo rate at 6.5% on August 8, 2024."' }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  console.log('Gemini 3.5 Flash Response:');
  console.log(res.data.candidates[0].content.parts[0].text);
}
test();
