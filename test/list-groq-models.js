const axios = require('axios');
const config = require('../src/config');

async function listGroq() {
  try {
    const res = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${config.apis.groq}` }
    });
    console.log('Available Groq models:');
    res.data.data.forEach(m => console.log(' -', m.id));
  } catch (e) {
    console.log('List Groq models failed:', e.response?.data || e.message);
  }
}
listGroq();
