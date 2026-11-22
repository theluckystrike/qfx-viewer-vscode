'use strict';
// View model helpers for QFX OFX Statement Viewer: filtering, pagination (capped at 5,000 rows in the free view),
// summary chips, account card and transaction detail formatting. No vscode import.

const MAX_FREE_ROWS = 5000;

function makeMatcher(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  const m = /^\/(.+)\/([a-z]*)$/.exec(s);
  if (m) {
    let re;
    try { re = new RegExp(m[1], m[2].replace(/[gy]/g, '')); }
    catch (e) { throw new Error(`The search ${s} is not a valid regular expression: ${e.message}`); }
    return (t) => re.test(t);
  }
  const low = s.toLowerCase();
  return (t) => t.toLowerCase().includes(low);
}

function txMatches(tx, test, typeFilter) {
  if (typeFilter && tx.type !== typeFilter) return false;
  if (!test) return true;
  if (test(tx.date || '')) return true;
  if (test(tx.type || '')) return true;
  if (test(tx.name || '')) return true;
  if (test(tx.memo || '')) return true;
  if (test(tx.fitid || '')) return true;
  if (test(tx.checkNum || '')) return true;
  if (test(String(tx.amount))) return true;
  return false;
}

function fmtAmount(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

class QfxViewModel {
  constructor(parsed, fileName, byteSize) {
    this.parsed = parsed;
    this.fileName = fileName;
    this.byteSize = byteSize;
    this.filter = { text: '', type: '' };
    this.filtered = this.parsed.transactions.slice(0, MAX_FREE_ROWS);
    this.truncatedView = this.parsed.transactions.length > MAX_FREE_ROWS;
  }

  setFilter(f) {
    const next = {
      text: f && typeof f.text === 'string' ? f.text.trim() : '',
      type: f && typeof f.type === 'string' ? f.type : '',
    };
    const test = makeMatcher(next.text);
    this.filter = next;
    const all = this.parsed.transactions.filter((tx) => txMatches(tx, test, next.type));
    this.truncatedView = all.length > MAX_FREE_ROWS;
    this.filtered = all.slice(0, MAX_FREE_ROWS);
    return this.filtered.length;
  }

  summary() {
    const p = this.parsed;
    const s = p.stats;
    const trnTypes = [...new Set(p.transactions.map((t) => t.type).filter(Boolean))].sort();
    return {
      fileName: this.fileName,
      byteSize: this.byteSize,
      ok: p.ok,
      truncatedFile: p.truncated,
      truncatedView: this.truncatedView,
      maxRows: MAX_FREE_ROWS,
      encoding: p.encoding,
      flavor: p.flavor,
      header: p.header,
      signon: p.signon,
      account: p.account,
      balances: {
        ...p.balances,
        ledgerFormatted: fmtAmount(p.balances.ledger),
        availableFormatted: fmtAmount(p.balances.available),
      },
      statementRange: p.statementRange,
      trnTypes,
      duplicateFitids: p.duplicateFitids,
      warnings: p.warnings,
      errors: p.errors,
      rawPreview: p.rawPreview,
      prettyOfx: p.prettyOfx,
      stats: {
        ...s,
        debitsFormatted: fmtAmount(s.sumDebits),
        creditsFormatted: fmtAmount(s.sumCredits),
        netFormatted: fmtAmount(s.netTotal),
      },
      payeeTotals: p.payeeTotals.map((x) => ({ ...x, totalFormatted: fmtAmount(x.total) })),
    };
  }

  count() { return this.filtered.length; }
  totalCount() { return this.parsed.transactions.length; }

  rows(from, n) {
    return this.filtered.slice(from, from + n).map((tx) => ({
      index: tx.index,
      date: tx.date,
      type: tx.type,
      name: tx.name,
      memo: tx.memo,
      fitid: tx.fitid,
      checkNum: tx.checkNum,
      amount: tx.amount,
      amountFormatted: fmtAmount(tx.amount),
      runningBalance: tx.runningBalance,
      runningFormatted: fmtAmount(tx.runningBalance),
    }));
  }

  detail(txIndex) {
    const tx = this.parsed.transactions[txIndex];
    if (!tx) return null;
    return {
      ...tx,
      amountFormatted: fmtAmount(tx.amount),
      runningFormatted: fmtAmount(tx.runningBalance),
    };
  }

  checkBalanceSummary() {
    const p = this.parsed;
    return {
      total: p.stats.transactionCount,
      duplicates: p.duplicateFitids.length,
      errors: p.errors.length,
      warnings: p.warnings.length,
      ledger: fmtAmount(p.balances.ledger),
      net: fmtAmount(p.stats.netTotal),
    };
  }
}

module.exports = { QfxViewModel, MAX_FREE_ROWS, makeMatcher, fmtAmount };
