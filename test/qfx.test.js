'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseQfx, decodeOfxBuffer, parseOfxDate, buildCsv, buildQbo, buildValidationMarkdown, prettyPrintOfx } = require('../src/qfx');
const { QfxViewModel } = require('../src/view');
const { editorHtml } = require('../src/html');
const { createPro, TRIES, TRIAL_KEY } = require('../src/pro');

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let i = 1; i < 10000; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

const FIX = path.join(__dirname, 'fixtures');
const readFix = (name) => fs.readFileSync(path.join(FIX, name));

test('HFIX6 card-statement.qfx: OFX 2.x XML credit card path', () => {
  const res = parseQfx(readFix('card-statement.qfx'));
  assert.equal(res.ok, true);
  assert.equal(res.flavor, 'OFX 2.x XML');
  assert.equal(res.account.kind, 'CREDITCARD');
  assert.equal(res.account.accountId, '4000111122224444');
  assert.equal(res.account.currency, 'CAD');
  assert.equal(res.stats.transactionCount, 13);
  assert.equal(res.transactions[0].fitid, 'E2E-NFLX-01');
  assert.equal(res.transactions[0].amount, -15.49);
  assert.equal(res.transactions[0].name, 'NETFLIX.COM');
  assert.equal(res.transactions[12].amount, 500);
  assert.equal(res.balances.ledger, null);
});

test('HFIX6 checking_2025.qfx: large SGML bank statement, 203 transactions, balance 25763.22', () => {
  const res = parseQfx(readFix('checking_2025.qfx'));
  assert.equal(res.ok, true);
  assert.equal(res.account.kind, 'BANK');
  assert.equal(res.account.accountId, '999900004821');
  assert.equal(res.account.currency, 'USD');
  assert.equal(res.balances.ledger, 25763.22);
  assert.equal(res.stats.transactionCount, 203);
  assert.equal(res.statementRange.startUtc, '2025-01-01 17:00:00');
  assert.equal(res.statementRange.endUtc, '2025-12-31 17:00:00');
  assert.equal(res.transactions[0].amount, -2850.0);
  assert.equal(res.transactions[0].name, 'BAYVIEW PROP MGMT RENT PMT WEB I');
});

test('HFIX6 qfx-sgml-v1.qfx: minimal OFX 1.03 SGML happy path', () => {
  const res = parseQfx(readFix('qfx-sgml-v1.qfx'));
  assert.equal(res.ok, true);
  assert.equal(res.account.accountId, 'FICTIONAL-4321');
  assert.equal(res.account.bankId, '999000111');
  assert.equal(res.balances.ledger, 383.25);
  assert.equal(res.stats.transactionCount, 1);
  assert.equal(res.transactions[0].amount, 85);
  assert.equal(res.transactions[0].name, 'Fictional Workshop Receipts');
  assert.equal(res.transactions[0].memo, 'Workshop income');
});

test('HFIX6 testQfxMalformedBody.QFX: malformed body handled without crash', () => {
  const res = parseQfx(readFix('testQfxMalformedBody.QFX'));
  assert.ok(res.warnings.length > 0);
  assert.ok(res.rawPreview.length > 0);
  assert.equal(res.stats.transactionCount, 0);
});

test('HFIX6 truncated-edge.qfx: truncation reported cleanly, no crash', () => {
  const res = parseQfx(readFix('truncated-edge.qfx'));
  assert.equal(res.ok, false);
  assert.equal(res.truncated, true);
  assert.ok(res.errors.length > 0);
});

test('Windows-1252 charset decoding preserves accented characters like é', () => {
  const header = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><BANKID>1<ACCTID>2<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260501<TRNAMT>-12.50<FITID>A1<NAME>Caf';
  const tail = ' Lumi';
  const end = 're</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const buf = Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from([0xE9]), Buffer.from(tail, 'latin1'), Buffer.from([0xE8]), Buffer.from(end, 'latin1')]);
  const dec = decodeOfxBuffer(buf);
  assert.equal(dec.encoding, 'Windows-1252');
  const res = parseQfx(buf);
  assert.equal(res.transactions[0].name, 'Café Lumière');
});

test('parseOfxDate handles timezone offsets and short YYYYMMDD', () => {
  const d1 = parseOfxDate('20250101120000.000[-5:EST]');
  assert.equal(d1.isoDate, '2025-01-01');
  assert.equal(d1.utcDateTime, '2025-01-01 17:00:00');
  const d2 = parseOfxDate('20260628');
  assert.equal(d2.isoDate, '2026-06-28');
  assert.equal(d2.utcDateTime, '2026-06-28 00:00:00');
});

test('CSV and QBO writers produce valid round-trippable output', () => {
  const res = parseQfx(readFix('card-statement.qfx'));
  const csv = buildCsv(res, 'card-statement.qfx', { bom: true });
  assert.ok(csv.startsWith('\uFEFFdate,type,amount,payee,memo,fitid,account,currency,source_file\n'));
  assert.ok(csv.includes('2026-01-03,DEBIT,-15.49,NETFLIX.COM,,E2E-NFLX-01,4000111122224444,CAD,card-statement.qfx'));

  const qbo = buildQbo(res);
  assert.ok(qbo.startsWith('OFXHEADER:100\nDATA:OFXSGML\nVERSION:103'));
  const roundtrip = parseQfx(qbo);
  assert.equal(roundtrip.ok, true);
  assert.equal(roundtrip.stats.transactionCount, 13);
  assert.equal(roundtrip.account.accountId, '4000111122224444');
});

test('Validation markdown report summarizes transactions and errors', () => {
  const md = buildValidationMarkdown([
    { fileName: 'card-statement.qfx', parsed: parseQfx(readFix('card-statement.qfx')) },
  ]);
  assert.match(md, /# QFX \/ QBO Statement Validation Report/);
  assert.match(md, /Files checked: 1/);
  assert.match(md, /Transactions: 13/);
});

test('prettyPrintOfx indents OFX tags cleanly', () => {
  const pretty = prettyPrintOfx('<OFX><SONRS><CODE>0</SONRS></OFX>');
  assert.ok(pretty.includes('  <SONRS>'));
});

test('QfxViewModel filters and paginates transactions', () => {
  const res = parseQfx(readFix('card-statement.qfx'));
  const vm = new QfxViewModel(res, 'card-statement.qfx', 3247);
  assert.equal(vm.count(), 13);
  assert.equal(vm.setFilter({ text: 'netflix' }), 4);
  assert.equal(vm.rows(0, 10).length, 4);
  assert.equal(vm.setFilter({ text: '', type: 'CREDIT' }), 1);
  assert.ok(vm.detail(0));
});

test('editorHtml has strict nonce CSP and support footer', () => {
  const html = editorHtml({ cspSource: 'vscode-webview://x', script: 'v.js', styleUri: 'v.css', title: 'a.qfx', nonce: 'abc' });
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'nonce-abc'"));
  assert.ok(html.includes('zovo-support'));
});

test('uniquePath never overwrites existing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qfx-uniq-'));
  try {
    const p = path.join(dir, 'out.csv');
    fs.writeFileSync(p, 'existing');
    const p2 = uniquePath(p);
    assert.notEqual(p2, p);
    assert.ok(p2.endsWith('out-1.csv'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Pro A-then-B 1-free-try: tool A uses 1 try, 2nd click asks Pro, tool B still has 1 free try', async () => {
  const store = new Map();
  let requireCalls = 0;
  let statusMsg = '';
  const fakeVscode = {
    EventEmitter: class {
      constructor() { this.event = () => ({ dispose() {} }); }
      fire() {}
      dispose() {}
    },
    window: { setStatusBarMessage: (m) => { statusMsg = m; } },
  };
  const fakeCtx = {
    subscriptions: [],
    globalState: {
      get: (k) => store.get(k),
      update: async (k, v) => { store.set(k, v); },
    },
  };
  const fakeLic = {
    isPro: () => false,
    requirePro: async () => { requireCalls += 1; return false; },
    ready: Promise.resolve(),
  };
  const pro = createPro({ vscode: fakeVscode, context: fakeCtx, license: fakeLic });
  assert.equal(TRIES, 1);
  assert.equal(pro.left('exportCsvQbo'), 1);
  assert.equal(pro.left('validateStatement'), 1);

  assert.equal(await pro.allowed('exportCsvQbo'), true);
  await pro.produced('exportCsvQbo');
  assert.equal(pro.left('exportCsvQbo'), 0);
  assert.equal(pro.used('exportCsvQbo'), 1);
  assert.match(statusMsg, /1 of 1/);
  assert.equal(store.get(TRIAL_KEY).exportCsvQbo, 1);

  // 2nd click on tool A hits requirePro
  assert.equal(await pro.allowed('exportCsvQbo'), false);
  assert.equal(requireCalls, 1);

  // Tool B still has its own 1 free try
  assert.equal(await pro.allowed('validateStatement'), true);
  await pro.produced('validateStatement');
  assert.equal(pro.left('validateStatement'), 0);
  assert.equal(await pro.allowed('validateStatement'), false);
  assert.equal(requireCalls, 2);
});
