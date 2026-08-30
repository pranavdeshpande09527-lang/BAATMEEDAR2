const axios = require('axios');
const config = require('../src/config');

async function testChat() {
  const models = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
  for (const m of models) {
    try {
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: m,
        messages: [{ role: 'user', content: 'Return JSON: {"message": "Groq working"}' }],
        response_format: { type: 'json_object' }
      }, {
        headers: { Authorization: `Bearer ${config.apis.groq}` },
        timeout: 10000
      });
      console.log(`Model ${m}: SUCCESS ->`, res.data.choices[0].message.content);
      return m;
    } catch (e) {
      console.log(`Model ${m}: failed ->`, e.response?.status, e.response?.data?.error?.message || e.message);
    }
  }
}
testChat();
