// FS AI — CMS admin + public article tests.
//
// Covers the migration-004 CMS contract against the shared fake D1
// (tests/fake-d1.js): public reads use the real schema columns
// (division_id / published_at, JOIN business_divisions), drafts,
// future-scheduled articles and inactive-division articles stay hidden
// from the public, admin CRUD works behind the owner token, edits store
// a revision, publish/unpublish flip visibility, duplicate slugs 409.
// The same routes against a real SQLite database live in
// tests/real-db.test.js.
// Run: node --test tests/cms.test.js (or: npm test)
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { handleRequest, publishDueArticles } = require('../src/index.js');
const { makeOwnerEnv, loginOk, authedRequest } = require('./fake-d1.js');

const WORKER_URL = 'http://localhost';

async function createArticle(env, token, body) {
  const res = await handleRequest(authedRequest('POST', '/api/admin/articles', token, body), env);
  const data = await res.json();
  return { res, data };
}

describe('CMS admin articles (/api/admin/articles)', () => {
  let env;
  let token;

  before(async () => {
    env = await makeOwnerEnv();
    token = await loginOk(handleRequest, env);
  });

  it('admin create without a token returns 401', async () => {
    const res = await handleRequest(authedRequest('POST', '/api/admin/articles', null, {
      title: 'No Token Article Title', body: 'Body text.', division: 'automotive',
    }), env);
    assert.equal(res.status, 401);
  });

  it('admin create with a token returns 201 with the article', async () => {
    const { res, data } = await createArticle(env, token, {
      title: 'Test Drive: A Fake CMS Article',
      division: 'automotive',
      excerpt: 'A test excerpt.',
      body: 'A test body with enough words to look like an article.',
      tags: ['test', 'cms'],
      fact_checked: 1,
    });
    assert.equal(res.status, 201);
    assert.equal(data.ok, true);
    assert.equal(data.article.title, 'Test Drive: A Fake CMS Article');
    assert.equal(data.article.slug, 'test-drive-a-fake-cms-article');
    assert.equal(data.article.division, 'automotive');
    assert.equal(data.article.status, 'draft');
    assert.deepEqual(data.article.tags, ['cms', 'test']);
  });

  it('admin create validates: missing body returns 400, unknown division returns 400', async () => {
    const noBody = await createArticle(env, token, { title: 'Missing Body Article', division: 'automotive' });
    assert.equal(noBody.res.status, 400);
    const badDiv = await createArticle(env, token, { title: 'Bad Division Article', body: 'Body.', division: 'no-such-division' });
    assert.equal(badDiv.res.status, 400);
  });

  it('duplicate slug returns 409', async () => {
    const first = await createArticle(env, token, { title: 'Unique Slug Article', body: 'Body one.', division: 'automotive' });
    assert.equal(first.res.status, 201);
    const second = await createArticle(env, token, { title: 'Unique Slug Article', body: 'Body two.', division: 'ai-technology' });
    assert.equal(second.res.status, 409);
    assert.match(second.data.error, /slug already exists/);
  });

  it('edit stores a revision of the previous version, then updates', async () => {
    const created = await createArticle(env, token, { title: 'Revision Test Article', body: 'Original body.', division: 'automotive' });
    const id = created.data.article.id;
    const editRes = await handleRequest(authedRequest('PUT', `/api/admin/articles/${id}`, token, { body: 'Edited body.', title: 'Revision Test Article Edited' }), env);
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.article.body, 'Edited body.');
    const revRes = await handleRequest(authedRequest('GET', `/api/admin/articles/${id}/revisions`, token), env);
    assert.equal(revRes.status, 200);
    const revs = await revRes.json();
    assert.equal(revs.total, 1);
    assert.equal(revs.revisions[0].body, 'Original body.');
    assert.equal(revs.revisions[0].title, 'Revision Test Article');
  });

  it('publish makes the article public, unpublish hides it again', async () => {
    const created = await createArticle(env, token, { title: 'Publish Flow Article', body: 'Publish body.', division: 'automotive' });
    const id = created.data.article.id;
    const slug = created.data.article.slug;
    const pubRes = await handleRequest(authedRequest('POST', `/api/admin/articles/${id}/publish`, token), env);
    assert.equal(pubRes.status, 200);
    const published = await pubRes.json();
    assert.equal(published.article.status, 'published');
    assert.ok(published.article.published_at, 'publish stamps published_at');
    const publicRes = await handleRequest(new Request(`${WORKER_URL}/api/articles/${slug}`), env);
    assert.equal(publicRes.status, 200);
    const unpubRes = await handleRequest(authedRequest('POST', `/api/admin/articles/${id}/unpublish`, token), env);
    assert.equal(unpubRes.status, 200);
    assert.equal((await unpubRes.json()).article.status, 'draft');
    const goneRes = await handleRequest(new Request(`${WORKER_URL}/api/articles/${slug}`), env);
    assert.equal(goneRes.status, 404);
  });

  it('admin list shows drafts; public list excludes drafts', async () => {
    const created = await createArticle(env, token, { title: 'Draft Only Article', body: 'Draft body.', division: 'automotive' });
    assert.equal(created.res.status, 201);
    const adminRes = await handleRequest(authedRequest('GET', '/api/admin/articles?status=draft', token), env);
    const admin = await adminRes.json();
    assert.ok(admin.articles.some((a) => a.slug === 'draft-only-article'), 'draft visible to admin');
    const publicRes = await handleRequest(new Request(`${WORKER_URL}/api/articles`), env);
    const pub = await publicRes.json();
    assert.ok(!pub.articles.some((a) => a.slug === 'draft-only-article'), 'draft hidden from public');
  });

  it('future-scheduled published article stays hidden until publish_at passes', async () => {
    const created = await createArticle(env, token, {
      title: 'Future Scheduled Article', body: 'Future body.', division: 'automotive',
      status: 'published', publish_at: '2999-01-01T00:00:00.000Z',
    });
    assert.equal(created.res.status, 201);
    const publicRes = await handleRequest(new Request(`${WORKER_URL}/api/articles/future-scheduled-article`), env);
    assert.equal(publicRes.status, 404);
    const listRes = await handleRequest(new Request(`${WORKER_URL}/api/articles`), env);
    const list = await listRes.json();
    assert.ok(!list.articles.some((a) => a.slug === 'future-scheduled-article'));
  });

  it('article in an inactive division is hidden from the public', async () => {
    const divRes = await handleRequest(authedRequest('POST', '/api/admin/divisions', token, {
      name: 'Temp Division', slug: 'temp-division',
    }), env);
    assert.equal(divRes.status, 201);
    const divId = (await divRes.json()).division.id;
    const created = await createArticle(env, token, {
      title: 'Temp Division Article', body: 'Temp body.', division: 'temp-division', status: 'published',
    });
    assert.equal(created.res.status, 201);
    const before = await handleRequest(new Request(`${WORKER_URL}/api/articles/temp-division-article`), env);
    assert.equal(before.status, 200);
    const deact = await handleRequest(authedRequest('PUT', `/api/admin/divisions/${divId}`, token, { is_active: 0 }), env);
    assert.equal(deact.status, 200);
    const after = await handleRequest(new Request(`${WORKER_URL}/api/articles/temp-division-article`), env);
    assert.equal(after.status, 404);
    const divList = await handleRequest(new Request(`${WORKER_URL}/api/divisions`), env);
    const divisions = await divList.json();
    assert.ok(!divisions.divisions.some((d) => d.slug === 'temp-division'), 'inactive division hidden from public list');
  });

  it('single health article carries the general-information disclaimer', async () => {
    const created = await createArticle(env, token, {
      title: 'Walking Health Test Article', body: 'Health body.', division: 'health-wellness', status: 'published',
    });
    assert.equal(created.res.status, 201);
    const res = await handleRequest(new Request(`${WORKER_URL}/api/articles/walking-health-test-article`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.article.disclaimer, /General information only/);
    assert.match(body.article.disclaimer, /not medical\/financial advice/);
  });

  it('short-body D1 rows are still returned (frontend falls back by slug)', async () => {
    const created = await createArticle(env, token, {
      title: 'Short Body Article', body: 'Tiny body.', division: 'automotive', status: 'published',
    });
    assert.equal(created.res.status, 201);
    const res = await handleRequest(new Request(`${WORKER_URL}/api/articles/short-body-article`), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.article.body, 'Tiny body.');
  });

  it('delete removes the article but its revisions remain listable', async () => {
    const created = await createArticle(env, token, { title: 'Delete Me Article', body: 'V1 body.', division: 'automotive' });
    const id = created.data.article.id;
    await handleRequest(authedRequest('PUT', `/api/admin/articles/${id}`, token, { body: 'V2 body.' }), env);
    const delRes = await handleRequest(authedRequest('DELETE', `/api/admin/articles/${id}`, token), env);
    assert.equal(delRes.status, 200);
    const getRes = await handleRequest(authedRequest('GET', `/api/admin/articles/${id}`, token), env);
    assert.equal(getRes.status, 404);
    const revRes = await handleRequest(authedRequest('GET', `/api/admin/articles/${id}/revisions`, token), env);
    assert.equal(revRes.status, 200);
    assert.equal((await revRes.json()).total, 1);
  });

  it('scheduled handler publishes a due approved article and leaves the future one', async () => {
    const due = await createArticle(env, token, {
      title: 'Due Scheduled Article', body: 'Due body.', division: 'automotive',
      status: 'approved', publish_at: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(due.res.status, 201);
    const result = await publishDueArticles(env);
    assert.equal(result.ok, true);
    assert.ok(result.published >= 1, 'at least the due article publishes');
    assert.ok(result.slugs.includes('due-scheduled-article'));
    const publicRes = await handleRequest(new Request(`${WORKER_URL}/api/articles/due-scheduled-article`), env);
    assert.equal(publicRes.status, 200);
    const futureRes = await handleRequest(new Request(`${WORKER_URL}/api/articles/future-scheduled-article`), env);
    assert.equal(futureRes.status, 404);
  });

  it('divisions admin: create duplicate slug 409, delete with articles 409', async () => {
    const dup = await handleRequest(authedRequest('POST', '/api/admin/divisions', token, { name: 'Automotive Copy', slug: 'automotive' }), env);
    assert.equal(dup.status, 409);
    const auto = await handleRequest(authedRequest('GET', '/api/admin/divisions', token), env);
    const automotive = (await auto.json()).divisions.find((d) => d.slug === 'automotive');
    const del = await handleRequest(authedRequest('DELETE', `/api/admin/divisions/${automotive.id}`, token), env);
    assert.equal(del.status, 409);
    assert.match((await del.json()).error, /article/);
  });
});
