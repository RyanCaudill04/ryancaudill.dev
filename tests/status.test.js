// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { check, report, fromApp } from '../functions/api/status.js';

const answer = (status, body = '') => async () => new Response(body, { status });
const t = (over = {}) => ({ id: 'x', url: 'https://x.test/h', ...over });

test('states', async () => {
  const cases = [
    ['no url', t({ url: '' }), answer(200), 'unknown'],
    ['2xx', t(), answer(200, 'ok'), 'up'],
    ['5xx', t(), answer(503), 'down'],
    ['access login', t(), answer(302), 'unknown'],
    ['forbidden', t(), answer(403), 'unknown'],
    ['unreachable', t(), async () => { throw new TypeError('fail'); }, 'down'],
    ['sleeping', t({ stateField: 'state' }), answer(200, '{"state":"sleeping"}'), 'sleeping'],
    ['active', t({ stateField: 'state' }), answer(200, '{"state":"active"}'), 'up'],
    ['offline', t({ stateField: 'state' }), answer(200, '{"state":"offline"}'), 'down'],
    ['garbled', t({ stateField: 'state' }), answer(200, 'not json'), 'unknown'],
  ];
  for (const [name, target, fetchFn, want] of cases) {
    assert.equal(await check(target, { fetchFn }), want, name);
  }
});

test('report checks a shared URL once and labels each service', async () => {
  let hits = 0;
  const fetchFn = async () => { hits++; return new Response('{"state":"sleeping"}'); };
  const targets = [
    t({ id: 'play', stateField: 'state' }),
    t({ id: 'minecraft', stateField: 'state' }),
    t({ id: 'ai', url: '' }),
  ];
  const r = await report(targets, { fetchFn });
  assert.equal(hits, 1);
  assert.deepEqual(r.services.play, { state: 'sleeping', text: 'active (sleeping)' });
  assert.equal(r.services.minecraft.state, 'sleeping');
  assert.equal(r.services.ai.text, 'not monitored');
});

test('fromApp', () => assert.equal(fromApp('whatever'), 'unknown'));
