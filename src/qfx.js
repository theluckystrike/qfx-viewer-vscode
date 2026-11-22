'use strict';
// Pure JavaScript Quicken Financial Exchange (.qfx) and QuickBooks (.qbo) / OFX 1.x SGML & 2.x XML parser,
// pretty-printer, CSV/QBO serializer, and statement validator. Zero runtime dependencies. No vscode import.

// Windows-1252 mapping for 0x80..0x9F
const CP1252_MAP = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
};

function decodeWindows1252(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x80 && b <= 0x9F && CP1252_MAP[b]) {
      out += String.fromCharCode(CP1252_MAP[b]);
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Sniff charset from ASCII header bytes, then decode buffer cleanly. */
function decodeOfxBuffer(input) {
  if (typeof input === 'string') {
    return { text: input.replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'UTF-8 (BOM)' };
  }
  const headAscii = buf.slice(0, Math.min(buf.length, 1024)).toString('latin1');
  const xmlEnc = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(headAscii);
  const hdrCharset = /^\s*CHARSET\s*:\s*([^\r\n]+)/im.exec(headAscii);
  const hdrEnc = /^\s*ENCODING\s*:\s*([^\r\n]+)/im.exec(headAscii);

  const encHint = (xmlEnc ? xmlEnc[1] : (hdrEnc ? hdrEnc[1] : '')).trim().toUpperCase();
  const csHint = (hdrCharset ? hdrCharset[1] : '').trim().toUpperCase();

  if (encHint.includes('UTF-8') || encHint.includes('UTF8') || csHint === 'UTF-8' || csHint === 'UTF8') {
    return { text: buf.toString('utf8'), encoding: 'UTF-8' };
  }
  if (csHint.includes('1252') || csHint.includes('WINDOWS-1252') || csHint.includes('CP1252')) {
    return { text: decodeWindows1252(buf), encoding: 'Windows-1252' };
  }
  if (csHint.includes('8859-1') || csHint.includes('ISO-8859-1') || csHint.includes('LATIN1')) {
    return { text: buf.toString('latin1'), encoding: 'ISO-8859-1' };
  }
  // Check if valid UTF-8; if replacement characters appear, fall back to Windows-1252.
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    return { text: decodeWindows1252(buf), encoding: 'Windows-1252' };
  }
  return { text: utf8, encoding: 'UTF-8' };
}

/** Parse OFX date string like 20250101120000.000[-5:EST] or 20260103.
 *  Returns { isoDate: 'YYYY-MM-DD', utcDateTime: 'YYYY-MM-DD HH:MM:SS', raw }. */
function parseOfxDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return { isoDate: '', utcDateTime: '', raw: '' };
  const tzMatch = /\[([+-]?\d+(?:\.\d+)?)(?::([^\]]*))?\]/.exec(s);
  const beforeBracket = s.split('[')[0].trim();
  const digits = beforeBracket.replace(/\.\d+$/, '').replace(/\D/g, '');
  if (digits.length < 8) return { isoDate: '', utcDateTime: '', raw: s };

  const y = Number(digits.slice(0, 4));
  const mo = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const hh = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0;
  const mm = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0;
  const ss = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0;

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { isoDate: '', utcDateTime: '', raw: s };

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`;

  // Compute UTC timestamp applying offset (matching ofxparse behavior: local - offset = UTC)
  let ms = Date.UTC(y, mo - 1, d, hh, mm, ss);
  if (tzMatch) {
    const offsetHours = Number(tzMatch[1]);
    if (Number.isFinite(offsetHours)) {
      ms -= Math.round(offsetHours * 3600 * 1000);
    }
  }
  const dt = new Date(ms);
  const utcDateTime = `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
  return { isoDate, utcDateTime, raw: s };
}

function parseAmount(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = /^[+-]?\d+(?:,\d{3})*(?:\.\d+)?/.exec(s.replace(/\s+/g, ''));
  if (!m) {
    const n = Number(s.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Extract SGML or XML header block and locate the `<OFX>` body. */
function parseHeader(text) {
  const header = {};
  const ofxIdx = text.search(/<OFX\b/i);
  const headText = ofxIdx >= 0 ? text.slice(0, ofxIdx) : text.slice(0, 1024);
  let flavor = 'unknown';

  const piXml = /<\?xml[^>]*\?>/i.exec(headText);
  const piOfx = /<\?OFX\s+([^?>]+)\?>/i.exec(headText);
  if (piXml || piOfx) {
    flavor = 'OFX 2.x XML';
    if (piOfx) {
      for (const m of piOfx[1].matchAll(/([A-Z0-9_.-]+)\s*=\s*["']([^"']*)["']/gi)) {
        header[m[1].toUpperCase()] = m[2];
      }
    }
  }

  for (const rawLine of headText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('<?') || line.startsWith('<!--')) continue;
    const m = /^([A-Z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (m) {
      header[m[1].toUpperCase()] = m[2].trim();
      if (flavor === 'unknown') flavor = 'OFX 1.x SGML';
    } else if (/OFXHEADER\s*:\s*(\d+)/i.test(line)) {
      const m2 = /OFXHEADER\s*:\s*(\d+)/i.exec(line);
      header.OFXHEADER = m2[1];
      if (flavor === 'unknown') flavor = 'OFX 1.x SGML';
    }
  }

  return { header, flavor, ofxIdx, headText };
}

/** Extract the inner text of a single container block like `<STMTRS>...</STMTRS>`. */
function extractBlock(body, tagName) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const m = openRe.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
  const cm = closeRe.exec(body.slice(start));
  if (!cm) return { content: body.slice(start), closed: false };
  return { content: body.slice(start, start + cm.index), closed: true };
}

/** Extract all occurrences of a repeating block like `<STMTTRN>...</STMTTRN>`. */
function extractBlocks(body, tagName) {
  const out = [];
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
  let m;
  while ((m = openRe.exec(body)) !== null) {
    const start = m.index + m[0].length;
    const rest = body.slice(start);
    const cm = closeRe.exec(rest);
    if (cm) {
      out.push({ content: rest.slice(0, cm.index), closed: true });
      openRe.lastIndex = start + cm.index + cm[0].length;
    } else {
      // Unclosed block (possible truncation)
      out.push({ content: rest, closed: false });
      break;
    }
  }
  return out;
}

/** Extract a leaf tag value from an SGML or XML fragment. */
function extractLeaf(fragment, tagName) {
  if (!fragment) return '';
  const re = new RegExp(`<${tagName}\\b[^>]*>([^<]*)`, 'i');
  const m = re.exec(fragment);
  if (!m) return '';
  return decodeXmlEntities(m[1]).trim();
}

/** Pretty-print raw OFX SGML/XML tags with clean indentation (capped for huge files). */
function prettyPrintOfx(text, maxLines = 400) {
  const cleaned = String(text || '').replace(/\r\n?/g, '\n');
  const ofxIdx = cleaned.search(/<OFX\b/i);
  const head = ofxIdx > 0 ? cleaned.slice(0, ofxIdx).trim() : '';
  const body = ofxIdx >= 0 ? cleaned.slice(ofxIdx) : cleaned;

  const lines = [];
  if (head) {
    for (const l of head.split('\n')) lines.push(l);
    lines.push('');
  }

  let depth = 0;
  const tokenRe = /<!--[\s\S]*?-->|<\/?[A-Za-z0-9_.:-]+(?:\s+[^>]*)?>|[^<]+/g;
  const tokens = body.match(tokenRe) || [];
  for (let i = 0; i < tokens.length && lines.length < maxLines; i++) {
    const tok = tokens[i].trim();
    if (!tok) continue;
    if (tok.startsWith('<!--')) {
      lines.push('  '.repeat(depth) + tok);
    } else if (tok.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push('  '.repeat(depth) + tok);
    } else if (tok.startsWith('<')) {
      const next = i + 1 < tokens.length ? tokens[i + 1].trim() : '';
      const afterNext = i + 2 < tokens.length ? tokens[i + 2].trim() : '';
      const tagM = /^<([A-Za-z0-9_.:-]+)/.exec(tok);
      const tagName = tagM ? tagM[1].toUpperCase() : '';
      if (next && !next.startsWith('<')) {
        if (afterNext && afterNext.toUpperCase() === `</${tagName}>`) {
          lines.push('  '.repeat(depth) + tok + next + afterNext);
          i += 2;
        } else {
          lines.push('  '.repeat(depth) + tok + next);
          i += 1;
        }
      } else {
        lines.push('  '.repeat(depth) + tok);
        if (!tok.endsWith('/>') && !tok.startsWith('<?')) depth += 1;
      }
    } else {
      lines.push('  '.repeat(depth) + tok);
    }
  }
  if (lines.length >= maxLines) {
    lines.push(`... (truncated at ${maxLines} lines)`);
  }
  return lines.join('\n');
}

/** Main parser for `.qfx` and `.qbo` buffers or strings. */
function parseQfx(input) {
  const { text, encoding } = decodeOfxBuffer(input);
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const rawPreview = rawLines.slice(0, 8);
  const warnings = [];
  const errors = [];

  if (!text.trim()) {
    errors.push('File is empty.');
    return emptyResult(encoding, rawPreview, warnings, errors, text);
  }

  const { header, flavor, ofxIdx } = parseHeader(text);
  if (ofxIdx < 0) {
    errors.push('No <OFX> root element found. This does not look like a QFX or QBO file.');
    return emptyResult(encoding, rawPreview, warnings, errors, text, header, flavor);
  }

  // Strip XML comments from body before tag extraction
  const rawBody = text.slice(ofxIdx);
  const body = rawBody.replace(/<!--[\s\S]*?-->/g, '');
  const hasClosingOfx = /<\/OFX\s*>/i.test(body);
  let truncated = false;

  if (!hasClosingOfx) {
    truncated = true;
    errors.push('File is truncated before </OFX> closing tag.');
  }

  // Detect malformed header prefix or broken tags
  if (ofxIdx > 0 && /^[^\r\n]+OFXHEADER\s*:/i.test(text.slice(0, ofxIdx))) {
    warnings.push('Unexpected prefix before OFXHEADER.');
  }
  if (/<[A-Za-z0-9_.-]+<[A-Za-z0-9_.-]+>/.test(body) || /<SIGNONMSGSRSTATUS>/i.test(body)) {
    warnings.push('Malformed OFX tags detected in statement body.');
  }

  // Signon status
  const sonrsBlock = extractBlock(body, 'SONRS') || extractBlock(body, 'SIGNONMSGSRSV1');
  const signon = {
    code: '',
    severity: '',
    message: '',
    dtServer: '',
    language: '',
    org: '',
    fid: '',
    intuBid: '',
  };
  if (sonrsBlock) {
    const statusBlock = extractBlock(sonrsBlock.content, 'STATUS');
    const stSrc = statusBlock ? statusBlock.content : sonrsBlock.content;
    signon.code = extractLeaf(stSrc, 'CODE');
    signon.severity = extractLeaf(stSrc, 'SEVERITY');
    signon.message = extractLeaf(stSrc, 'MESSAGE');
    signon.dtServer = parseOfxDate(extractLeaf(sonrsBlock.content, 'DTSERVER')).isoDate;
    signon.language = extractLeaf(sonrsBlock.content, 'LANGUAGE');
    signon.org = extractLeaf(sonrsBlock.content, 'ORG');
    signon.fid = extractLeaf(sonrsBlock.content, 'FID');
    signon.intuBid = extractLeaf(sonrsBlock.content, 'INTU.BID');
  }

  // Statement block (Bank or Credit Card)
  const bankStmt = extractBlock(body, 'STMTRS');
  const ccStmt = extractBlock(body, 'CCSTMTRS');
  const stmtBlock = bankStmt || ccStmt;
  const statementKind = bankStmt ? 'BANK' : (ccStmt ? 'CREDITCARD' : 'UNKNOWN');

  if (!stmtBlock) {
    errors.push('No statement aggregate (<STMTRS> or <CCSTMTRS>) found.');
  } else if (!stmtBlock.closed) {
    truncated = true;
    errors.push(`Statement aggregate <${bankStmt ? 'STMTRS' : 'CCSTMTRS'}> is truncated.`);
  }

  const stmtContent = stmtBlock ? stmtBlock.content : body;
  const currency = extractLeaf(stmtContent, 'CURDEF') || 'USD';

  // Account info
  const bankAcct = extractBlock(stmtContent, 'BANKACCTFROM');
  const ccAcct = extractBlock(stmtContent, 'CCACCTFROM');
  const account = {
    kind: statementKind,
    bankId: bankAcct ? extractLeaf(bankAcct.content, 'BANKID') : '',
    accountId: bankAcct
      ? extractLeaf(bankAcct.content, 'ACCTID')
      : (ccAcct ? extractLeaf(ccAcct.content, 'ACCTID') : ''),
    accountType: bankAcct
      ? (extractLeaf(bankAcct.content, 'ACCTTYPE') || 'BANK')
      : (ccAcct ? 'CREDITCARD' : ''),
    currency,
  };

  // Balances
  const ledgerBlock = extractBlock(stmtContent, 'LEDGERBAL');
  const availBlock = extractBlock(stmtContent, 'AVAILBAL');
  const ledgerAmt = ledgerBlock ? parseAmount(extractLeaf(ledgerBlock.content, 'BALAMT')) : null;
  const ledgerDate = ledgerBlock ? parseOfxDate(extractLeaf(ledgerBlock.content, 'DTASOF')) : { isoDate: '', utcDateTime: '', raw: '' };
  const availAmt = availBlock ? parseAmount(extractLeaf(availBlock.content, 'BALAMT')) : null;
  const availDate = availBlock ? parseOfxDate(extractLeaf(availBlock.content, 'DTASOF')) : { isoDate: '', utcDateTime: '', raw: '' };

  const balances = {
    ledger: ledgerAmt,
    ledgerAsOf: ledgerDate.isoDate,
    available: availAmt,
    availableAsOf: availDate.isoDate,
  };

  // Transaction list
  const tranListBlock = extractBlock(stmtContent, 'BANKTRANLIST');
  const tranSrc = tranListBlock ? tranListBlock.content : stmtContent;
  const dtStart = parseOfxDate(extractLeaf(tranSrc, 'DTSTART'));
  const dtEnd = parseOfxDate(extractLeaf(tranSrc, 'DTEND'));

  const trnBlocks = extractBlocks(tranSrc, 'STMTTRN');
  const transactions = [];
  const fitidCounts = new Map();
  let sumDebits = 0;
  let sumCredits = 0;
  let malformedTxnCount = 0;

  for (const blk of trnBlocks) {
    if (!blk.closed) {
      truncated = true;
      errors.push('A <STMTTRN> transaction block is truncated before </STMTTRN>.');
      continue;
    }
    const c = blk.content;
    const trnType = extractLeaf(c, 'TRNTYPE');
    const dtPostedRaw = extractLeaf(c, 'DTPOSTED');
    const dtPosted = parseOfxDate(dtPostedRaw);
    const trnAmtRaw = extractLeaf(c, 'TRNAMT');
    const amount = parseAmount(trnAmtRaw);
    const fitid = extractLeaf(c, 'FITID');
    const name = extractLeaf(c, 'NAME');
    const memo = extractLeaf(c, 'MEMO');
    const checkNum = extractLeaf(c, 'CHECKNUM');
    const payeeId = extractLeaf(c, 'PAYEEID');
    const refNum = extractLeaf(c, 'REFNUM');
    const sic = extractLeaf(c, 'SIC');

    // If a STMTTRN has neither a valid date nor a valid amount, mark malformed
    if (!dtPosted.isoDate || amount === null) {
      malformedTxnCount += 1;
      warnings.push(`Malformed transaction row skipped (missing ${!dtPosted.isoDate ? 'DTPOSTED' : 'TRNAMT'}).`);
      continue;
    }

    if (amount < 0) sumDebits += amount;
    else sumCredits += amount;

    if (fitid) fitidCounts.set(fitid, (fitidCounts.get(fitid) || 0) + 1);

    const rowKey = `${account.accountId}|${fitid}|${dtPosted.isoDate}|${trnAmtRaw}`;
    transactions.push({
      index: transactions.length,
      rowKey,
      type: trnType,
      date: dtPosted.isoDate,
      dateUtc: dtPosted.utcDateTime,
      dtPostedRaw,
      amount,
      amountRaw: trnAmtRaw,
      fitid,
      name,
      memo,
      checkNum,
      payeeId,
      refNum,
      sic,
      runningBalance: null,
    });
  }

  // Compute running balance
  if (transactions.length > 0) {
    if (balances.ledger !== null) {
      // Back-calculate from ledger balance at the end of the statement
      let bal = balances.ledger;
      for (let i = transactions.length - 1; i >= 0; i--) {
        transactions[i].runningBalance = Math.round(bal * 100) / 100;
        bal -= transactions[i].amount;
      }
    } else {
      let bal = 0;
      for (let i = 0; i < transactions.length; i++) {
        bal += transactions[i].amount;
        transactions[i].runningBalance = Math.round(bal * 100) / 100;
      }
    }
  }

  const duplicateFitids = [...fitidCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ fitid: id, count: n }));

  // Dates range from transactions if DTSTART/DTEND missing
  const sortedDates = transactions.map((t) => t.date).filter(Boolean).sort();
  const firstDate = sortedDates.length ? sortedDates[0] : dtStart.isoDate;
  const lastDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : dtEnd.isoDate;

  // Payee totals
  const payeeMap = new Map();
  for (const tx of transactions) {
    const key = tx.name || '(Unnamed)';
    const cur = payeeMap.get(key) || { payee: key, count: 0, total: 0 };
    cur.count += 1;
    cur.total = Math.round((cur.total + tx.amount) * 100) / 100;
    payeeMap.set(key, cur);
  }
  const payeeTotals = [...payeeMap.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    ok: errors.length === 0,
    truncated,
    encoding,
    flavor,
    header,
    signon,
    account,
    balances,
    statementRange: {
      start: dtStart.isoDate,
      startUtc: dtStart.utcDateTime,
      end: dtEnd.isoDate,
      endUtc: dtEnd.utcDateTime,
    },
    transactions,
    payeeTotals,
    duplicateFitids,
    stats: {
      transactionCount: transactions.length,
      malformedTxnCount,
      sumDebits: Math.round(sumDebits * 100) / 100,
      sumCredits: Math.round(sumCredits * 100) / 100,
      netTotal: Math.round((sumCredits + sumDebits) * 100) / 100,
      firstDate,
      lastDate,
      ofxVersion: header.VERSION || (flavor === 'OFX 2.x XML' ? '220' : ''),
      charset: header.CHARSET || encoding,
      compression: header.COMPRESSION || 'NONE',
    },
    rawPreview,
    prettyOfx: prettyPrintOfx(text),
    warnings,
    errors,
  };
}

function emptyResult(encoding, rawPreview, warnings, errors, text, header = {}, flavor = 'unknown') {
  return {
    ok: false,
    truncated: false,
    encoding,
    flavor,
    header,
    signon: { code: '', severity: '', message: '', dtServer: '', language: '', org: '', fid: '', intuBid: '' },
    account: { kind: 'UNKNOWN', bankId: '', accountId: '', accountType: '', currency: '' },
    balances: { ledger: null, ledgerAsOf: '', available: null, availableAsOf: '' },
    statementRange: { start: '', startUtc: '', end: '', endUtc: '' },
    transactions: [],
    payeeTotals: [],
    duplicateFitids: [],
    stats: {
      transactionCount: 0,
      malformedTxnCount: 0,
      sumDebits: 0,
      sumCredits: 0,
      netTotal: 0,
      firstDate: '',
      lastDate: '',
      ofxVersion: header.VERSION || '',
      charset: header.CHARSET || encoding,
      compression: header.COMPRESSION || 'NONE',
    },
    rawPreview,
    prettyOfx: prettyPrintOfx(text, 200),
    warnings,
    errors,
  };
}

/** RFC 4180 CSV cell quoting. */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build CSV from parsed QFX/QBO statement. Stable column order per HPLAN6. */
function buildCsv(parsed, fileName, opts = {}) {
  const cols = ['date', 'type', 'amount', 'payee', 'memo', 'fitid', 'account', 'currency', 'source_file'];
  const lines = [cols.join(',')];
  const acct = parsed.account.accountId || '';
  const cur = parsed.account.currency || '';
  for (const tx of parsed.transactions) {
    lines.push([
      tx.date,
      tx.type,
      tx.amount.toFixed(2),
      tx.name,
      tx.memo,
      tx.fitid,
      acct,
      cur,
      fileName || '',
    ].map(csvCell).join(','));
  }
  const body = lines.join('\n') + '\n';
  return opts.bom ? '\uFEFF' + body : body;
}

/** Serialize parsed statement into clean OFX 1.0.3 SGML (.qbo) per OFX 1.0.3 spec. */
function buildQbo(parsed) {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dtServer = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
  const isCard = parsed.account.kind === 'CREDITCARD';
  const cur = parsed.account.currency || 'USD';
  const acctId = parsed.account.accountId || '0000';
  const bankId = parsed.account.bankId || '000000000';
  const acctType = parsed.account.accountType || 'CHECKING';
  const dtStart = (parsed.statementRange.start || parsed.stats.firstDate || '').replace(/-/g, '');
  const dtEnd = (parsed.statementRange.end || parsed.stats.lastDate || '').replace(/-/g, '');

  const out = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:103',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    `<DTSERVER>${dtServer}`,
    `<LANGUAGE>${parsed.signon.language || 'ENG'}`,
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
  ];

  if (isCard) {
    out.push('<CREDITCARDMSGSRSV1>', '<CCSTMTTRNRS>', '<TRNUID>1', '<STATUS><CODE>0<SEVERITY>INFO</STATUS>', '<CCSTMTRS>');
    out.push(`<CURDEF>${escapeXml(cur)}`);
    out.push('<CCACCTFROM>', `<ACCTID>${escapeXml(acctId)}`, '</CCACCTFROM>');
  } else {
    out.push('<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1', '<STATUS><CODE>0<SEVERITY>INFO</STATUS>', '<STMTRS>');
    out.push(`<CURDEF>${escapeXml(cur)}`);
    out.push('<BANKACCTFROM>', `<BANKID>${escapeXml(bankId)}`, `<ACCTID>${escapeXml(acctId)}`, `<ACCTTYPE>${escapeXml(acctType)}`, '</BANKACCTFROM>');
  }

  out.push('<BANKTRANLIST>');
  if (dtStart) out.push(`<DTSTART>${dtStart}`);
  if (dtEnd) out.push(`<DTEND>${dtEnd}`);
  for (const tx of parsed.transactions) {
    out.push('<STMTTRN>');
    out.push(`<TRNTYPE>${escapeXml(tx.type || (tx.amount < 0 ? 'DEBIT' : 'CREDIT'))}`);
    out.push(`<DTPOSTED>${escapeXml(tx.date.replace(/-/g, ''))}`);
    out.push(`<TRNAMT>${tx.amount.toFixed(2)}`);
    if (tx.fitid) out.push(`<FITID>${escapeXml(tx.fitid)}`);
    if (tx.name) out.push(`<NAME>${escapeXml(tx.name)}`);
    if (tx.memo) out.push(`<MEMO>${escapeXml(tx.memo)}`);
    if (tx.checkNum) out.push(`<CHECKNUM>${escapeXml(tx.checkNum)}`);
    out.push('</STMTTRN>');
  }
  out.push('</BANKTRANLIST>');

  if (parsed.balances.ledger !== null) {
    out.push('<LEDGERBAL>', `<BALAMT>${parsed.balances.ledger.toFixed(2)}`);
    if (parsed.balances.ledgerAsOf) out.push(`<DTASOF>${parsed.balances.ledgerAsOf.replace(/-/g, '')}`);
    out.push('</LEDGERBAL>');
  }

  if (isCard) {
    out.push('</CCSTMTRS>', '</CCSTMTTRNRS>', '</CREDITCARDMSGSRSV1>');
  } else {
    out.push('</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>');
  }
  out.push('</OFX>', '');
  return out.join('\n');
}

/** Build a Markdown validation report for one or more parsed QFX/QBO files. */
function buildValidationMarkdown(entries) {
  const totalTx = entries.reduce((a, e) => a + e.parsed.stats.transactionCount, 0);
  const totalDup = entries.reduce((a, e) => a + e.parsed.duplicateFitids.length, 0);
  const totalErr = entries.reduce((a, e) => a + e.parsed.errors.length, 0);
  const totalWarn = entries.reduce((a, e) => a + e.parsed.warnings.length, 0);

  const lines = [
    '# QFX / QBO Statement Validation Report',
    '',
    `- Files checked: ${entries.length}`,
    `- Transactions: ${totalTx}`,
    `- Duplicate FITIDs: ${totalDup}`,
    `- Parse errors: ${totalErr}`,
    `- Warnings: ${totalWarn}`,
    '',
    '| File | Account | Currency | Transactions | Credits | Debits | Ledger balance | Duplicate FITIDs | Errors |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
  ];

  for (const { fileName, parsed } of entries) {
    const st = parsed.stats;
    const bal = parsed.balances.ledger !== null ? parsed.balances.ledger.toFixed(2) : 'n/a';
    lines.push(`| ${fileName} | ${parsed.account.accountId || '(none)'} | ${parsed.account.currency || ''} | ${st.transactionCount} | ${st.sumCredits.toFixed(2)} | ${st.sumDebits.toFixed(2)} | ${bal} | ${parsed.duplicateFitids.length} | ${parsed.errors.length} |`);
  }

  for (const { fileName, parsed } of entries) {
    if (parsed.errors.length || parsed.warnings.length || parsed.duplicateFitids.length) {
      lines.push('', `## ${fileName}`);
      for (const e of parsed.errors) lines.push(`- Error: ${e}`);
      for (const w of parsed.warnings) lines.push(`- Warning: ${w}`);
      for (const d of parsed.duplicateFitids) lines.push(`- Duplicate FITID: \`${d.fitid}\` (${d.count} times)`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  parseQfx,
  decodeOfxBuffer,
  parseOfxDate,
  parseAmount,
  prettyPrintOfx,
  buildCsv,
  buildQbo,
  buildValidationMarkdown,
  csvCell,
};
