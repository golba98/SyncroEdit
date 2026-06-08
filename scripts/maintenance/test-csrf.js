const http = require('http');

const port = process.env.PORT || 3000;
const baseUrl = `http://localhost:${port}`;

function request(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data ? JSON.parse(data) : null,
          });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testCSRF() {
  console.log('--- Testing CSRF Flow (Native HTTP) ---');

  try {
    // 1. Get CSRF Token
    console.log('1. Fetching CSRF Token...');
    const csrfRes = await request(`${baseUrl}/api/auth/csrf-token`, { method: 'GET' });
    console.log('   Response Status:', csrfRes.status);
    console.log('   Response Headers:', JSON.stringify(csrfRes.headers, null, 2));
    console.log('   Response Data:', JSON.stringify(csrfRes.data, null, 2));

    const csrfToken = csrfRes.data ? csrfRes.data.csrfToken : null;
    const cookies = csrfRes.headers['set-cookie'];

    console.log(`   Token: ${csrfToken ? csrfToken.substring(0, 20) + '...' : 'NONE'}`);
    console.log(`   Cookies: ${cookies ? cookies.join(', ') : 'NONE'}`);

    if (!csrfToken || !cookies) {
      console.error('FAILED: Missing token or cookies');
      return;
    }

    // 2. Try a POST request with the token and cookies
    console.log('\n2. Attempting POST /api/auth/login with CSRF...');
    const loginRes = await request(
      `${baseUrl}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          Cookie: cookies.join('; '),
        },
      },
      { username: 'tester', password: 'wrongpassword' }
    );

    console.log(`   Status: ${loginRes.status}`);
    console.log(`   Body: ${JSON.stringify(loginRes.data)}`);

    if (loginRes.status === 401 || loginRes.status === 403) {
      if (
        loginRes.data &&
        loginRes.data.message &&
        loginRes.data.message.includes('Invalid username')
      ) {
        console.log('   SUCCESS: CSRF accepted (rejected by auth as expected)');
      } else if (loginRes.status === 403) {
        console.log('   FAILED: Rejected with 403 (CSRF failure)');
      }
    } else if (loginRes.status === 200) {
      console.log('   SUCCESS: Logged in (CSRF passed)');
    }

    // 3. Try a POST request WITHOUT token
    console.log('\n3. Attempting POST /api/auth/login WITHOUT CSRF...');
    const failRes = await request(
      `${baseUrl}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      { username: 'tester', password: 'wrongpassword' }
    );

    console.log(`   Status: ${failRes.status}`);
    if (failRes.status === 403) {
      console.log('   SUCCESS: Correctly blocked request without CSRF');
    } else {
      console.log('   FAILED: Should have blocked request with 403');
    }
  } catch (err) {
    console.error('Global Error:', err.message);
  }
}

testCSRF();
