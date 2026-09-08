// Run from web/: node --test tests/phase2-safety.test.cjs
// Uses the project's existing TypeScript devDependency, no extra packages.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/lib/businessSafety.ts'),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject={};vm.runInNewContext(output,{exports:exportsObject,URL,Error});
const {safeHttpUrl,resolveMediaUrl,normalizeSocial}=exportsObject;
for(const value of ['javascript:alert(1)','data:text/html,<svg onload=alert(1)>','//evil.test','https://user:secret@example.test','https://example.test/ bad','https://example.test/\\evil','java\nscript:alert(1)']) {
  test(`unsafe href blocked: ${JSON.stringify(value)}`,()=>assert.equal(safeHttpUrl(value),null));
}
test('HTTP(S) URL kept',()=>assert.equal(safeHttpUrl('https://example.test/page'),'https://example.test/page'));
test('/api media root',()=>assert.equal(resolveMediaUrl('https://api.example.test/api','/storage/businesses/a.png'),'https://api.example.test/storage/businesses/a.png'));
test('/api/v1 media root',()=>assert.equal(resolveMediaUrl('https://api.example.test/api/v1','/storage/businesses/a.png'),'https://api.example.test/storage/businesses/a.png'));
test('subdirectory deployment',()=>assert.equal(resolveMediaUrl('https://example.test/backend/api','/storage/businesses/a.png'),'https://example.test/backend/storage/businesses/a.png'));
for(const value of ['/storage/../secret','/storage/%2e%2e/secret','//evil.test/image','/storage/a.png?script=1','javascript:alert(1)']) test(`unsafe media blocked: ${value}`,()=>assert.equal(resolveMediaUrl('https://api.example.test/api',value),null));
test('Persian WhatsApp number',()=>assert.equal(normalizeSocial('whatsapp','۰۹۱۲۳۴۵۶۷۸۹'),'https://wa.me/989123456789'));
test('international WhatsApp number',()=>assert.equal(normalizeSocial('whatsapp','+44 7700 900123'),'https://wa.me/447700900123'));
test('website receives HTTPS',()=>assert.equal(normalizeSocial('website','www.example.test'),'https://www.example.test/'));
test('unsafe scheme is not normalized',()=>assert.throws(()=>normalizeSocial('website','javascript:alert(1)')));
test('protocol relative URL rejected',()=>assert.throws(()=>normalizeSocial('website','//evil.test')));
test('empty social value stays empty',()=>assert.equal(normalizeSocial('instagram','  '),''));
