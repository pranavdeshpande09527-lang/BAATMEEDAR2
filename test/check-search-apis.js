const axios = require('axios');
const config = require('../src/config');

async function testApis() {
  console.log('Testing Groq API...');
  try {
    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Say hello in JSON: {"status": "ok"}' }],
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${config.apis.groq}` },
      timeout: 10000
    });
    console.log('Groq SUCCESS ->', groqRes.data.choices[0].message.content);
  } catch (e) {
    console.log('Groq failed ->', e.response?.status, e.response?.data || e.message);
  }

  console.log('\nTesting Tavily API...');
  try {
    const tavilyRes = await axios.post('https://api.tavily.com/search', {
      api_key: config.apis.tavily,
      query: 'Chandrayaan-3 launch date ISRO',
      search_depth: 'basic',
      max_results: 3,
      include_raw_content: false
    }, { timeout: 10000 });
    console.log('Tavily SUCCESS -> Got', tavilyRes.data.results?.length, 'results');
    tavilyRes.data.results?.forEach(r => console.log(' -', r.title, '(', r.url, ')'));
  } catch (e) {
    console.log('Tavily failed ->', e.response?.status, e.response?.data || e.message);
  }
}
testApis();
