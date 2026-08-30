const axios = require('axios');
const config = require('../src/config');

async function listModels() {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apis.gemini}`;
    const res = await axios.get(url);
    console.log('Available models:');
    res.data.models.forEach(m => console.log(m.name, m.supportedGenerationMethods));
  } catch (e) {
    console.error('List models failed:', e.response?.data || e.message);
  }
}
listModels();
