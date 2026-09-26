import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';

async function runAcceptanceTests() {
  console.log('============================================================');
  console.log('ARCGPT PRODUCTION-GRADE FULL OFFLINE ACCEPTANCE TESTS');
  console.log('============================================================\n');

  // TEST 1: Local Services Health Check
  console.log('[TEST 1] Checking local server, PostgreSQL and Ollama...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.equal(healthRes.status, 200, 'Health endpoint should return 200');
  const health = await healthRes.json();
  console.log('  Health response:', health);
  assert.equal(health.server, 'ok');
  assert.equal(health.postgresql, 'ok');
  assert.equal(health.ollama, 'ok');
  console.log('  -> TEST 1 PASSED: PostgreSQL and Ollama are fully connected.\n');

  // Login as admin
  console.log('[AUTH] Logging in local administrator...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@institution.edu', password: 'AdminPassword123!' })
  });
  assert.equal(loginRes.status, 200, 'Login should succeed');
  const cookie = loginRes.headers.get('set-cookie');
  const authHeaders = {
    'Content-Type': 'application/json',
    'Cookie': cookie ? cookie.split(';')[0] : ''
  };
  console.log('  -> Authenticated successfully.\n');

  // Helper function to query
  async function ask(question: string) {
    const res = await fetch(`${BASE_URL}/api/query`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ question })
    });
    return res.json();
  }

  // TEST 2: How many students are there?
  console.log('[TEST 2] Question: How many students are there?');
  const t2 = await ask('How many students are there?');
  console.log('  SQL:', t2.sanitizedSql);
  console.log('  Result:', t2.rows);
  assert.equal(t2.status, 'success');
  const studentTotal = Number(t2.rows[0]?.count || t2.rows[0]?.total_students || 0);
  assert.equal(studentTotal, 180, 'Total students count must be 180');
  console.log('  -> TEST 2 PASSED: Real count of 180 students verified.\n');

  // TEST 3: How many students are in each department?
  console.log('[TEST 3] Question: How many students are in each department?');
  const t3 = await ask('How many students are in each department?');
  console.log('  SQL:', t3.sanitizedSql);
  console.log('  Row count:', t3.rowCount);
  assert.equal(t3.status, 'success');
  assert.equal(t3.rowCount, 6, 'Should return distribution for 6 departments');
  console.log('  -> TEST 3 PASSED: Department distribution verified.\n');

  // TEST 4: Which AIML students have attendance below 75%?
  console.log('[TEST 4] Question: Which AIML students have attendance below 75%?');
  const t4 = await ask('Which AIML students have attendance below 75%?');
  console.log('  SQL:', t4.sanitizedSql);
  console.log('  Row count:', t4.rowCount);
  console.log('  Sample row:', t4.rows[0]);
  assert.equal(t4.status, 'success');
  assert.ok(t4.rowCount > 0, 'Should find AIML students with attendance < 75%');
  console.log('  -> TEST 4 PASSED: Real attendance view records returned.\n');

  // TEST 5: What is the average CGPA of each department?
  console.log('[TEST 5] Question: What is the average CGPA of each department?');
  const t5 = await ask('What is the average CGPA of each department?');
  console.log('  SQL:', t5.sanitizedSql);
  console.log('  Rows count:', t5.rowCount);
  console.log('  Sample department CGPA:', t5.rows[0]);
  assert.equal(t5.status, 'success');
  assert.equal(t5.rowCount, 6, 'Should return CGPA average for 6 departments');
  console.log('  -> TEST 5 PASSED: Real academic CGPA statistics calculated.\n');

  // TEST 6: Which students have more than one active backlog?
  console.log('[TEST 6] Question: Which students have more than one active backlog?');
  const t6 = await ask('Which students have more than one active backlog?');
  console.log('  SQL:', t6.sanitizedSql);
  console.log('  Row count:', t6.rowCount);
  assert.equal(t6.status, 'success');
  assert.ok(t6.rowCount > 0, 'Should return students with multiple active backlogs');
  console.log('  -> TEST 6 PASSED: Real backlog data returned.\n');

  // TEST 7: Which faculty members teach Machine Learning?
  console.log('[TEST 7] Question: Which faculty members teach Machine Learning?');
  const t7 = await ask('Which faculty members teach Machine Learning?');
  console.log('  SQL:', t7.sanitizedSql);
  console.log('  Faculty:', t7.rows);
  assert.equal(t7.status, 'success');
  assert.ok(t7.rowCount > 0, 'Should return teaching faculty');
  console.log('  -> TEST 7 PASSED: Real course offering / faculty data returned.\n');

  // TEST 8: Who has not submitted Assignment 1?
  console.log('[TEST 8] Question: Who has not submitted Assignment 1?');
  const t8 = await ask('Who has not submitted Assignment 1?');
  console.log('  SQL:', t8.sanitizedSql);
  console.log('  Unsubmitted count:', t8.rowCount);
  assert.equal(t8.status, 'success');
  assert.ok(t8.rowCount > 0, 'Should return unsubmitted student records');
  console.log('  -> TEST 8 PASSED: Real assignment / submission data returned.\n');

  // TEST 9: Security Blocking (Delete all student records.)
  console.log('[TEST 9] Security Guard: Delete all student records.');
  const t9 = await ask('Delete all student records.');
  console.log('  Status:', t9.status, '| ResultStatus:', t9.resultStatus);
  console.log('  Message:', t9.naturalLanguageAnswer);
  assert.equal(t9.status, 'blocked');
  assert.equal(t9.resultStatus, 'BLOCKED');
  // Verify student count remains 180 in database
  const checkCount = await ask('How many students are there?');
  assert.equal(Number(checkCount.rows[0]?.count || checkCount.rows[0]?.total_students), 180);
  console.log('  -> TEST 9 PASSED: Destructive DML blocked and database remains untouched.\n');

  console.log('============================================================');
  console.log('ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY (100% PASS RATE)');
  console.log('============================================================');
}

runAcceptanceTests().catch(err => {
  console.error('Acceptance test failed:', err);
  process.exit(1);
});
